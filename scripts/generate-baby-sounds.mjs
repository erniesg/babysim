import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'audio', 'baby');
const TMP_DIR = path.join(REPO_ROOT, 'tmp', 'baby-sounds');
// Optional fallback directory for pre-baked baby audio packs (out-of-tree).
// Set BABY_SOUNDS_FALLBACK_DIR in the env if you have a local pre-baked pack to copy from.
//
// NOTE: the live files in public/audio/baby/ shipped today are NOT generated
// by this script — they're real recordings from the donateacry public dataset
// (hungry / tired / discomfort / burping → mapped to hunger / tired /
// discomfort / coo). This script is a regenerator: it can re-emit synthetic
// cries via Gemini TTS or ElevenLabs (lower fidelity), and the
// `fallbackSource` filenames below reference an older "same-baby-pack" naming
// convention used when this regenerator pulls from a fallback dir. To
// re-import donateacry, copy the canonical files directly from the dataset
// dir (see HANDOFF.md → "Baby sounds").
const FALLBACK_DIR = process.env.BABY_SOUNDS_FALLBACK_DIR
  ? path.resolve(process.env.BABY_SOUNDS_FALLBACK_DIR)
  : null;

const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

const CLIPS = [
  {
    name: 'hunger',
    voice: 'Charon',
    geminiPrompt:
      'Read this with a whining, rising pitch and lots of energy, like fussy non-verbal sounds: "uh uh uhhhh wahhh wahhh uh uh wahhhhh"',
    elevenPrompt:
      'newborn 0-8 weeks, rhythmic hunger fuss, soft wail with brief silence, no adult voice or music, close-mic',
    fallbackSource: 'hunger_fuss-same-baby-pack.mp3',
  },
  {
    name: 'tired',
    voice: 'Puck',
    geminiPrompt:
      'Read this softly and slowly with a fading, drowsy tone, like sleepy non-verbal sounds: "uhh uhhh ehhh uhhh ehhh"',
    elevenPrompt:
      'newborn 0-8 weeks, sleepy tired whimper, half-cry winding down, no adult voice or music, close-mic',
    fallbackSource: 'tired_whimper-same-baby-pack.mp3',
  },
  {
    name: 'discomfort',
    voice: 'Charon',
    geminiPrompt:
      'Speak as a newborn baby in distress, sustained wailing, no words just cry sounds: "wah wah wah uh wah wah uh wah wahhhh"',
    elevenPrompt:
      'newborn 0-8 weeks, strained discomfort cry, not screaming, distressed but not peak, close-mic',
    fallbackSource: 'discomfort_cry-same-baby-pack.mp3',
  },
  {
    name: 'coo',
    voice: 'Kore',
    geminiPrompt:
      'Speak as a contented baby cooing softly and gently, no words just gentle vocalizations: "aah ooh aaaaah ooh aah"',
    elevenPrompt:
      'newborn 0-8 weeks, contented coo and gurgle, gentle baby vocalization, no crying, close-mic',
    fallbackSource: 'burp_fuss-same-baby-pack.mp3',
  },
];

async function loadDotenv(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function wavFromPcm(pcm, { channels = 1, sampleRate = 24000, bitsPerSample = 16 } = {}) {
  const dataSize = pcm.byteLength;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function ffmpegAvailable() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

async function wavToMp3(wavPath, mp3Path) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-400)}`));
    });
  });
}

async function generateGemini({ clip, wavPath }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY missing');
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
  );
  url.searchParams.set('key', apiKey);
  const body = {
    contents: [{ parts: [{ text: clip.geminiPrompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: clip.voice } },
      },
    },
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.slice(0, 500)}`);
  }
  const json = await response.json();
  const part = json?.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData || p.inline_data,
  );
  const inline = part?.inlineData || part?.inline_data;
  const base64 = inline?.data;
  if (!base64) {
    throw new Error(`Gemini response missing inline audio: ${JSON.stringify(json).slice(0, 300)}`);
  }
  const pcm = Buffer.from(base64, 'base64');
  const wav = wavFromPcm(pcm);
  await fs.writeFile(wavPath, wav);
  return { bytes: wav.length, mimeType: inline.mimeType || inline.mime_type };
}

async function generateElevenLabs({ clip, mp3Path }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');
  const url = new URL('https://api.elevenlabs.io/v1/sound-generation');
  url.searchParams.set('output_format', 'mp3_44100_128');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      text: clip.elevenPrompt,
      model_id: 'eleven_text_to_sound_v2',
      duration_seconds: 3,
      loop: false,
      prompt_influence: 0.45,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs ${response.status}: ${errText.slice(0, 500)}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(mp3Path, buf);
  return { bytes: buf.length };
}

async function copyFallback({ clip, mp3Path }) {
  const src = path.join(FALLBACK_DIR, clip.fallbackSource);
  await fs.copyFile(src, mp3Path);
  const stat = await fs.stat(mp3Path);
  return { bytes: stat.size };
}

async function generateOne({ clip, force, hasFfmpeg }) {
  const mp3Path = path.join(OUT_DIR, `${clip.name}.mp3`);
  const wavPath = path.join(TMP_DIR, `${clip.name}.wav`);

  if (!force && (await fileExists(mp3Path))) {
    const stat = await fs.stat(mp3Path);
    return { name: clip.name, status: 'skipped', provider: 'existing', bytes: stat.size };
  }

  const errors = [];

  try {
    const r = await generateGemini({ clip, wavPath });
    if (hasFfmpeg) {
      await wavToMp3(wavPath, mp3Path);
      const stat = await fs.stat(mp3Path);
      return {
        name: clip.name,
        status: 'ok',
        provider: 'gemini',
        voice: clip.voice,
        bytes: stat.size,
        wavBytes: r.bytes,
        mimeType: r.mimeType,
      };
    }
    const wavOut = path.join(OUT_DIR, `${clip.name}.wav`);
    await fs.copyFile(wavPath, wavOut);
    return {
      name: clip.name,
      status: 'ok',
      provider: 'gemini',
      voice: clip.voice,
      bytes: r.bytes,
      ext: 'wav',
      warning: 'ffmpeg unavailable; saved as .wav (update AudioDirector URL map)',
    };
  } catch (err) {
    errors.push(`gemini: ${err.message}`);
  }

  try {
    const r = await generateElevenLabs({ clip, mp3Path });
    return {
      name: clip.name,
      status: 'ok',
      provider: 'elevenlabs-fallback',
      bytes: r.bytes,
      errors,
    };
  } catch (err) {
    errors.push(`elevenlabs: ${err.message}`);
  }

  try {
    const r = await copyFallback({ clip, mp3Path });
    return {
      name: clip.name,
      status: 'ok',
      provider: 'pack-copy-fallback',
      bytes: r.bytes,
      source: clip.fallbackSource,
      errors,
    };
  } catch (err) {
    errors.push(`fallback: ${err.message}`);
    return { name: clip.name, status: 'failed', errors };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  await loadDotenv(ENV_PATH);
  await ensureDir(OUT_DIR);
  await ensureDir(TMP_DIR);

  const hasFfmpeg = await ffmpegAvailable();
  if (!hasFfmpeg) console.warn('Warning: ffmpeg not found; will save .wav instead of .mp3.');

  const results = [];
  for (const clip of CLIPS) {
    process.stdout.write(`Generating ${clip.name} (gemini ${clip.voice}) ... `);
    const result = await generateOne({ clip, force, hasFfmpeg });
    if (result.status === 'ok') {
      console.log(`${result.provider} (${result.bytes} bytes${result.ext ? `, .${result.ext}` : ''})`);
    } else if (result.status === 'skipped') {
      console.log(`skipped (exists, ${result.bytes} bytes; pass --force to regenerate)`);
    } else {
      console.log(`FAILED: ${result.errors?.join(' | ')}`);
    }
    results.push(result);
  }

  console.log('\nSummary:');
  for (const r of results) {
    const tag = r.status === 'ok' ? r.provider : r.status;
    const note = r.warning ? `  [${r.warning}]` : r.errors ? `  [${r.errors.join(' | ')}]` : '';
    console.log(`  ${r.name.padEnd(12)} ${tag.padEnd(22)} ${r.bytes ?? 0} bytes${note}`);
  }
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
