import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'img');

const BASE_PROMPT = [
  'Stylized 1970s East Asian domestic drama portrait of a Singaporean/Malaysian co-parent at home, part of the same cinematic production as the "Officer Tan" government portraits.',
  'Setting: dim warm domestic interior — soft wood-panelled walls, a hint of a kitchen edge or dining doorway in the deep background, a low table lamp pooling warm amber light, faint crimson textile or curtain at the edge of frame echoing the officer set but softer and more home-y.',
  'Lighting: low-key warm key light from a practical lamp upper-left, gentle falloff into shadow, slightly desaturated film stock look, light film grain, painterly photographic feel, shallow depth of field.',
  'Wardrobe: casual home wear (no uniform, no government insignia, no badges) — soft fabrics, lived-in textures, muted earth and crimson tones consistent with the show palette.',
  'Style: cinematic, dignified, emotionally weighted, square 1:1 framing, tight head-and-shoulders, subject roughly centered, same crimson/gold palette as the officer cast so they read as one production but unmistakably domestic, NOT an office or government desk.',
].join(' ');

const VARIANTS = [
  {
    name: 'partner-anxious',
    description: [
      'Subject: a male-presenting co-parent in his mid-30s.',
      'Posture: slightly hunched forward, hands clasped tightly together near the chest, shoulders drawn in.',
      'Expression: eyes a touch too wide, brow lifted in worry, mouth softly open as if mid-quiet question, concerned but not unkind — visibly trying to hold it together.',
      'Wardrobe detail: rumpled soft cotton t-shirt or worn flannel shirt, slightly open collar, faint stain or crease suggesting a long day.',
    ].join(' '),
  },
  {
    name: 'partner-chill',
    description: [
      'Subject: a female-presenting co-parent in her late 20s to early 30s.',
      'Posture: leaning casually against a doorframe or wall, weight on one shoulder, completely unbothered, relaxed shoulders.',
      'Expression: one eyebrow slightly raised, a small lopsided half-smile, eyes calm and amused, like nothing in this house could surprise her.',
      'Wardrobe detail: oversized hoodie partly unzipped over a soft tee, sleeves slightly bunched, hair loose and slightly mussed.',
    ].join(' '),
  },
  {
    name: 'partner-resentful',
    description: [
      'Subject: a non-binary-presenting co-parent in their late 30s to early 40s, androgynous styling.',
      'Posture: arms tightly folded across the chest, body angled slightly away from camera, jaw set.',
      'Expression: mouth a hard flat line, eyes looking past camera into middle distance — the unmistakable look of someone who has been keeping score for a long time, cold and tired rather than openly angry.',
      'Wardrobe detail: dark olive button-up shirt, sleeves rolled to the forearm, no jewellery, severe and plain.',
    ].join(' '),
  },
  {
    name: 'partner-overfunctioner',
    description: [
      'Subject: a female-presenting co-parent in her early to mid 30s.',
      'Posture: slight forward lean, one hand holding a folded paper checklist or a worn pocket notebook, the other mid-gesture as if ticking through tasks.',
      'Expression: a tight performative competent half-smile that does not reach the eyes, faint dark circles and visible exhaustion under the eyes, brow faintly tense — the look of someone running the entire household on fumes.',
      'Wardrobe detail: neat blouse with sleeves pushed up, a thin apron string or tea towel slung at the waist, hair tied back tightly.',
    ].join(' '),
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

function detectImageFormat(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return 'unknown';
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 300)}`));
    });
  });
}

async function ensurePng(outPath) {
  const buf = await fs.readFile(outPath);
  const fmt = detectImageFormat(buf);
  if (fmt === 'png') return { transcoded: false, format: fmt };
  if (fmt === 'jpeg' || fmt === 'webp') {
    const tmp = `${outPath}.src`;
    await fs.rename(outPath, tmp);
    try {
      await runCmd('sips', ['-s', 'format', 'png', tmp, '--out', outPath]);
    } catch (e) {
      try { await runCmd('magick', [tmp, outPath]); }
      catch (e2) { try { await runCmd('ffmpeg', ['-y', '-i', tmp, outPath]); } catch (e3) { await fs.rename(tmp, outPath); throw e3; } }
    }
    await fs.unlink(tmp).catch(() => {});
    return { transcoded: true, format: fmt };
  }
  return { transcoded: false, format: fmt };
}

async function fileExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function buildPrompt(description) {
  return `${BASE_PROMPT} ${description}`;
}

async function generateGeminiImage({ prompt, outPath }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY missing');

  const candidates = [
    'gemini-3-pro-image-preview',
    'gemini-3-image-preview',
    'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation',
  ];

  let lastError;
  for (const model of candidates) {
    try {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      );
      url.searchParams.set('key', apiKey);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        lastError = new Error(`gemini ${model} ${response.status}: ${text.slice(0, 400)}`);
        continue;
      }
      const json = await response.json();
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const inlinePart = parts.find((p) => p.inlineData || p.inline_data);
      const inline = inlinePart?.inlineData || inlinePart?.inline_data;
      const base64 = inline?.data;
      if (!base64) {
        lastError = new Error(`gemini ${model}: response missing inline image`);
        continue;
      }
      const buf = Buffer.from(base64, 'base64');
      await fs.writeFile(outPath, buf);
      return { bytes: buf.length, model };
    } catch (err) {
      lastError = err;
    }
  }

  const imagenModels = ['imagen-4.0-generate-001', 'imagen-3.0-generate-002'];
  for (const model of imagenModels) {
    try {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
      );
      url.searchParams.set('key', apiKey);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        lastError = new Error(`imagen ${model} ${response.status}: ${text.slice(0, 400)}`);
        continue;
      }
      const json = await response.json();
      const pred = json?.predictions?.[0];
      const base64 = pred?.bytesBase64Encoded || pred?.image?.imageBytes;
      if (!base64) {
        lastError = new Error(`imagen ${model}: response missing image`);
        continue;
      }
      const buf = Buffer.from(base64, 'base64');
      await fs.writeFile(outPath, buf);
      return { bytes: buf.length, model };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini image attempts failed');
}

async function generateOpenAIImage({ prompt, outPath }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      background: 'opaque',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`openai ${response.status}: ${text.slice(0, 500)}`);
  }
  const json = await response.json();
  const item = (json.data || [])[0];
  const base64 = item?.b64_json || item?.b64Json || item?.image_base64;
  if (!base64) throw new Error('openai: response missing base64 image');
  const buf = Buffer.from(base64, 'base64');
  await fs.writeFile(outPath, buf);
  return { bytes: buf.length, model: 'gpt-image-1' };
}

function svgFallback(label) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="35%" cy="35%" r="85%">
      <stop offset="0%" stop-color="#5a2820"/>
      <stop offset="60%" stop-color="#2a140e"/>
      <stop offset="100%" stop-color="#120806"/>
    </radialGradient>
    <radialGradient id="lamp" cx="22%" cy="18%" r="50%">
      <stop offset="0%" stop-color="rgba(255,210,150,0.45)"/>
      <stop offset="100%" stop-color="rgba(255,210,150,0)"/>
    </radialGradient>
    <linearGradient id="shirt" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#3a2618"/>
      <stop offset="100%" stop-color="#1a1008"/>
    </linearGradient>
    <linearGradient id="skin" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#caa07a"/>
      <stop offset="100%" stop-color="#7a5a40"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#lamp)"/>
  <g opacity="0.16" stroke="#000" stroke-width="1">
    <path d="M0 760 H1024" /><path d="M0 820 H1024" /><path d="M0 880 H1024" />
  </g>
  <rect x="0" y="780" width="1024" height="244" fill="#2a1a0e"/>
  <rect x="0" y="780" width="1024" height="10" fill="#4a2e1a"/>
  <ellipse cx="512" cy="900" rx="360" ry="180" fill="url(#shirt)"/>
  <path d="M380 760 L512 700 L644 760 L644 1024 L380 1024 Z" fill="url(#shirt)"/>
  <ellipse cx="512" cy="540" rx="170" ry="210" fill="url(#skin)"/>
  <ellipse cx="512" cy="700" rx="100" ry="50" fill="url(#skin)"/>
  <path d="M362 460 Q512 320 662 460 Q662 380 512 340 Q362 380 362 460 Z" fill="#1a1a18"/>
  <ellipse cx="455" cy="540" rx="20" ry="9" fill="#1a1208"/>
  <ellipse cx="569" cy="540" rx="20" ry="9" fill="#1a1208"/>
  <path d="M462 645 Q512 655 562 645" stroke="#3a1a14" stroke-width="5" fill="none" stroke-linecap="round"/>
  <rect width="1024" height="1024" fill="url(#lamp)" opacity="0.4"/>
  <g font-family="Georgia, serif" fill="#caa64a" opacity="0.6">
    <text x="80" y="980" font-size="26" letter-spacing="6">${label.toUpperCase()}</text>
  </g>
</svg>`;
}

async function generateSvgFallback({ outPath, label }) {
  const svg = svgFallback(label);
  const svgPath = outPath.replace(/\.png$/, '.svg');
  await fs.writeFile(svgPath, svg, 'utf8');
  await fs.writeFile(outPath, svg, 'utf8');
  const stat = await fs.stat(outPath);
  return { bytes: stat.size, model: 'svg-fallback', svgPath };
}

async function generateOne({ variant, force }) {
  const outPath = path.join(OUT_DIR, `${variant.name}.png`);
  if (!force && (await fileExists(outPath))) {
    const stat = await fs.stat(outPath);
    return { name: variant.name, status: 'skipped', provider: 'existing', bytes: stat.size, outPath };
  }

  const prompt = buildPrompt(variant.description);
  const errors = [];

  try {
    const r = await generateGeminiImage({ prompt, outPath });
    const norm = await ensurePng(outPath).catch((e) => ({ transcoded: false, format: 'unknown', error: e.message }));
    const stat = await fs.stat(outPath);
    return { name: variant.name, status: 'ok', provider: `gemini:${r.model}`, bytes: stat.size, outPath, errors, normalized: norm };
  } catch (err) {
    errors.push(`gemini: ${err.message}`);
  }

  try {
    const r = await generateOpenAIImage({ prompt, outPath });
    const norm = await ensurePng(outPath).catch((e) => ({ transcoded: false, format: 'unknown', error: e.message }));
    const stat = await fs.stat(outPath);
    return { name: variant.name, status: 'ok', provider: `openai:${r.model}`, bytes: stat.size, outPath, errors, normalized: norm };
  } catch (err) {
    errors.push(`openai: ${err.message}`);
  }

  try {
    const r = await generateSvgFallback({ outPath, label: variant.name });
    return {
      name: variant.name,
      status: 'ok',
      provider: 'svg-fallback',
      bytes: r.bytes,
      outPath,
      warning: 'SVG fallback (no raster providers succeeded)',
      errors,
    };
  } catch (err) {
    errors.push(`svg: ${err.message}`);
    return { name: variant.name, status: 'failed', errors };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  await loadDotenv(ENV_PATH);
  await ensureDir(OUT_DIR);

  const results = [];
  for (const variant of VARIANTS) {
    process.stdout.write(`Generating ${variant.name}.png ... `);
    const result = await generateOne({ variant, force });
    if (result.status === 'ok') {
      console.log(`${result.provider} (${result.bytes} bytes)`);
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
    console.log(
      `  ${r.name.padEnd(26)} ${tag.padEnd(28)} ${r.bytes ?? 0} bytes${r.warning ? `  [${r.warning}]` : ''}`,
    );
    if (r.errors && r.errors.length && r.status !== 'failed') {
      for (const e of r.errors) console.log(`    note: ${e}`);
    }
  }
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
