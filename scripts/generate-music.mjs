import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const WANX_ENV_PATH = path.resolve(REPO_ROOT, '..', 'wanx', '.env');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'audio', 'music');
const TMP_DIR = path.join(REPO_ROOT, 'tmp', 'music');
const OUT_PATH = path.join(OUT_DIR, 'probation-theme.mp3');

const PROMPT =
  'Slow, ominous bureaucratic theme. Plucked strings, light timpani, distant brass. Evokes 1970s East Asian government drama. Instrumental, no vocals. Loopable.';

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

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getVertexAccessToken(credentialsPath) {
  const raw = await fs.readFile(credentialsPath, 'utf8');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signatureBuf = signer.sign(sa.private_key);
  const signature = signatureBuf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const jwt = `${signingInput}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const json = await response.json();
  return { token: json.access_token, projectId: sa.project_id };
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
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr.slice(-400)}`))));
  });
}

async function silenceMp3(mp3Path, seconds = 1) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=44100:cl=mono`,
        '-t',
        String(seconds),
        '-codec:a',
        'libmp3lame',
        '-q:a',
        '4',
        mp3Path,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg silence failed: ${stderr.slice(-400)}`)),
    );
  });
}

async function tryLyriaVertex({ region, model, accessToken, projectId, outWavPath }) {
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:predict`;
  const body = {
    instances: [{ prompt: PROMPT }],
    parameters: { sample_count: 1 },
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Lyria ${region}/${model} ${response.status}: ${errText.slice(0, 600)}`);
  }
  const json = await response.json();
  const pred = json?.predictions?.[0];
  const b64 =
    pred?.bytesBase64Encoded ||
    pred?.audioContent ||
    pred?.audio?.bytesBase64Encoded ||
    pred?.audio_content ||
    null;
  if (!b64) {
    throw new Error(`Lyria ${region}/${model} response missing audio: ${JSON.stringify(json).slice(0, 400)}`);
  }
  const buf = Buffer.from(b64, 'base64');
  await fs.writeFile(outWavPath, buf);
  return { bytes: buf.length, mimeType: pred?.mimeType || 'audio/wav' };
}

async function tryElevenLabsMusic({ outMp3Path }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing');
  const url = 'https://api.elevenlabs.io/v1/music';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      prompt: PROMPT,
      music_length_ms: 45000,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs Music ${response.status}: ${errText.slice(0, 500)}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outMp3Path, buf);
  return { bytes: buf.length };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  await loadDotenv(ENV_PATH);
  await loadDotenv(WANX_ENV_PATH);
  await ensureDir(OUT_DIR);
  await ensureDir(TMP_DIR);

  if (!force && (await fileExists(OUT_PATH))) {
    const stat = await fs.stat(OUT_PATH);
    console.log(`Skipping (exists, ${stat.size} bytes; pass --force to regenerate): ${OUT_PATH}`);
    return;
  }

  const hasFfmpeg = await ffmpegAvailable();
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const errors = [];

  if (credentialsPath && (await fileExists(credentialsPath))) {
    try {
      const { token, projectId } = await getVertexAccessToken(credentialsPath);
      const attempts = [
        { region: 'us-central1', model: 'lyria-002' },
        { region: 'us-central1', model: 'lyria-2' },
      ];
      for (const a of attempts) {
        try {
          process.stdout.write(`Trying Lyria ${a.region}/${a.model} ... `);
          const wavPath = path.join(TMP_DIR, 'probation-theme.wav');
          const r = await tryLyriaVertex({
            region: a.region,
            model: a.model,
            accessToken: token,
            projectId,
            outWavPath: wavPath,
          });
          console.log(`ok (${r.bytes} bytes ${r.mimeType})`);
          if (hasFfmpeg) {
            await wavToMp3(wavPath, OUT_PATH);
          } else {
            const wavOut = path.join(OUT_DIR, 'probation-theme.wav');
            await fs.copyFile(wavPath, wavOut);
            console.log(`Saved as .wav (no ffmpeg): ${wavOut}`);
          }
          const stat = await fs.stat(OUT_PATH);
          console.log(`Wrote ${OUT_PATH} (${stat.size} bytes)`);
          await fs.writeFile(
            path.join(OUT_DIR, 'probation-theme.metadata.json'),
            JSON.stringify(
              {
                provider: 'lyria-vertex',
                region: a.region,
                model: a.model,
                projectId,
                prompt: PROMPT,
                bytes: stat.size,
                generatedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
          return;
        } catch (err) {
          console.log(`fail: ${err.message.slice(0, 200)}`);
          errors.push(err.message);
        }
      }
    } catch (err) {
      console.log(`Vertex auth failed: ${err.message}`);
      errors.push(`vertex-auth: ${err.message}`);
    }
  } else {
    console.log('No GOOGLE_APPLICATION_CREDENTIALS available; skipping Lyria.');
    errors.push('no GOOGLE_APPLICATION_CREDENTIALS');
  }

  try {
    process.stdout.write('Trying ElevenLabs Music fallback ... ');
    const r = await tryElevenLabsMusic({ outMp3Path: OUT_PATH });
    console.log(`ok (${r.bytes} bytes)`);
    await fs.writeFile(
      path.join(OUT_DIR, 'probation-theme.metadata.json'),
      JSON.stringify(
        {
          provider: 'elevenlabs-music',
          prompt: PROMPT,
          bytes: r.bytes,
          generatedAt: new Date().toISOString(),
          warnings: errors,
        },
        null,
        2,
      ),
    );
    return;
  } catch (err) {
    console.log(`fail: ${err.message.slice(0, 200)}`);
    errors.push(`elevenlabs-music: ${err.message}`);
  }

  console.warn('All music providers failed; writing 1s silence placeholder.');
  if (hasFfmpeg) {
    await silenceMp3(OUT_PATH, 1);
  } else {
    await fs.writeFile(OUT_PATH, Buffer.alloc(0));
  }
  await fs.writeFile(
    path.join(OUT_DIR, 'probation-theme.metadata.json'),
    JSON.stringify(
      {
        provider: 'placeholder-silence',
        prompt: PROMPT,
        bytes: (await fs.stat(OUT_PATH)).size,
        generatedAt: new Date().toISOString(),
        errors,
      },
      null,
      2,
    ),
  );
  console.error('Errors:', errors.join(' | '));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
