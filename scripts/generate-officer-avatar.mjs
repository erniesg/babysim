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
  'Stylized 1970s East Asian government drama portrait of "Officer Tan", a 50-year-old Singaporean/Malaysian civil servant.',
  'Wardrobe: dark navy government uniform with a small gold lapel badge, crisp collar, narrow tie.',
  'Setting: dim crimson velvet curtain backdrop with soft folds; a wooden government desk in the lower-third foreground holds a brass desk stamp; faint gold accents catch light.',
  'Lighting: single dramatic key light from upper-left, deep falloff into shadow on the right side; warm undertones, slightly desaturated palette.',
  'Style: cinematic, dignified, faintly menacing, light film grain, painterly photographic feel, shallow depth of field.',
  'Composition: tight head-and-shoulders, square 1:1 framing, subject roughly centered, eyes just past camera as if reviewing a file.',
].join(' ');

const VARIANTS = [
  {
    name: 'officer-tan',
    expression:
      'strict and slightly skeptical expression, mouth a flat line, brow faintly furrowed, gaze just past camera as if reviewing a confidential file.',
  },
  {
    name: 'officer-tan-strict',
    expression:
      'severely strict and disapproving expression, jaw set, brow lowered, eyes narrowed and locked just past camera, lips pressed thin.',
  },
  {
    name: 'officer-tan-warm',
    expression:
      'subtly warm but still formal expression, faint suppressed half-smile, eyes slightly softened, head tilted a hair toward camera, dignified.',
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

function buildPrompt(expression) {
  return `${BASE_PROMPT} Expression: ${expression}`;
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

function svgFallback() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="35%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#7a1a22"/>
      <stop offset="60%" stop-color="#3a0a10"/>
      <stop offset="100%" stop-color="#180408"/>
    </radialGradient>
    <radialGradient id="key" cx="30%" cy="20%" r="55%">
      <stop offset="0%" stop-color="rgba(255,220,170,0.35)"/>
      <stop offset="100%" stop-color="rgba(255,220,170,0)"/>
    </radialGradient>
    <linearGradient id="uniform" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#162033"/>
      <stop offset="100%" stop-color="#0a0f1c"/>
    </linearGradient>
    <linearGradient id="skin" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#caa07a"/>
      <stop offset="100%" stop-color="#7a5a40"/>
    </linearGradient>
    <radialGradient id="badge" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#fff0b8"/>
      <stop offset="60%" stop-color="#c8962a"/>
      <stop offset="100%" stop-color="#5a3e0e"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#key)"/>
  <g opacity="0.18" stroke="#000" stroke-width="1">
    <path d="M40 0 V1024" /><path d="M180 0 V1024" /><path d="M340 0 V1024" />
    <path d="M520 0 V1024" /><path d="M700 0 V1024" /><path d="M860 0 V1024" />
  </g>
  <rect x="0" y="780" width="1024" height="244" fill="#3a2410"/>
  <rect x="0" y="780" width="1024" height="14" fill="#5a3a1a"/>
  <g transform="translate(760 820)">
    <rect x="0" y="0" width="120" height="80" rx="6" fill="#3a2a14" stroke="#1a1208" stroke-width="2"/>
    <rect x="44" y="-50" width="32" height="56" fill="#7a5a2a" stroke="#1a1208" stroke-width="2"/>
    <circle cx="60" cy="-60" r="14" fill="#caa64a" stroke="#3a2a14" stroke-width="2"/>
  </g>
  <ellipse cx="512" cy="900" rx="360" ry="180" fill="url(#uniform)"/>
  <path d="M380 760 L512 700 L644 760 L644 1024 L380 1024 Z" fill="url(#uniform)"/>
  <path d="M488 700 L512 760 L536 700 L520 820 L504 820 Z" fill="#0a0a14" stroke="#222" stroke-width="1"/>
  <circle cx="430" cy="780" r="14" fill="url(#badge)"/>
  <ellipse cx="512" cy="540" rx="170" ry="210" fill="url(#skin)"/>
  <ellipse cx="512" cy="700" rx="100" ry="50" fill="url(#skin)"/>
  <path d="M362 460 Q512 320 662 460 Q662 380 512 340 Q362 380 362 460 Z" fill="#1a1a22"/>
  <ellipse cx="455" cy="540" rx="22" ry="10" fill="#1a1208"/>
  <ellipse cx="569" cy="540" rx="22" ry="10" fill="#1a1208"/>
  <path d="M430 510 Q455 495 480 510" stroke="#0a0a08" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M544 510 Q569 495 594 510" stroke="#0a0a08" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M462 645 Q512 655 562 645" stroke="#3a1a14" stroke-width="5" fill="none" stroke-linecap="round"/>
  <rect width="1024" height="1024" fill="url(#key)" opacity="0.4"/>
  <g font-family="Georgia, serif" fill="#caa64a" opacity="0.65">
    <text x="80" y="980" font-size="28" letter-spacing="6">OFFICER  TAN</text>
  </g>
</svg>`;
}

async function generateSvgFallback({ outPath }) {
  const svg = svgFallback();
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

  const prompt = buildPrompt(variant.expression);
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
    const r = await generateSvgFallback({ outPath });
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
  const onlyCanonical = args.includes('--canonical-only');

  await loadDotenv(ENV_PATH);
  await ensureDir(OUT_DIR);

  const targets = onlyCanonical ? VARIANTS.slice(0, 1) : VARIANTS;
  const results = [];
  for (const variant of targets) {
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
      `  ${r.name.padEnd(22)} ${tag.padEnd(28)} ${r.bytes ?? 0} bytes${r.warning ? `  [${r.warning}]` : ''}`,
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
