import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'img');

// Shared cinematic framing used by all three character prompts
const SHARED_FRAMING = [
  'Wardrobe: dark navy government uniform with a small gold lapel badge, crisp collar, narrow tie.',
  'Setting: dim crimson velvet curtain backdrop with soft folds; a wooden government desk in the lower-third foreground holds a brass desk stamp; faint gold accents catch light.',
  'Lighting: single dramatic key light from upper-left, deep falloff into shadow on the right side; warm undertones, slightly desaturated palette.',
  'Style: cinematic, dignified, faintly menacing, light film grain, painterly photographic feel, shallow depth of field. Photorealistic puppet with felt/fur textures and visible stitching — not cartoon.',
  'Composition: tight head-and-shoulders, square 1:1 framing, subject roughly centered, eyes just past camera as if reviewing a file.',
  'No text, no watermarks, no overlaid graphics.',
].join(' ');

// Per-character base prompts — Sesame-Street-inspired puppet civil servants in government uniform
const CHARACTER_BASE_PROMPTS = {
  Ernest: [
    'Stylized 1970s Singaporean government-drama portrait of "Officer Ernest", a colorful hand-puppet character in an official role.',
    'Ernest is a whimsical fabric puppet with a round head, large oval eyes with prominent black pupils, warm orange felt/fur tone, and a half-smile.',
    'He is dressed in a dark navy government uniform with a narrow tie and small gold lapel badge.',
    SHARED_FRAMING,
  ].join(' '),
  Bern: [
    'Stylized 1970s Singaporean government-drama portrait of "Officer Bern", a colorful hand-puppet character in an official role.',
    'Bern is a whimsical fabric puppet with a tall oval head, a heavy mono-brow, yellow felt/fur tone, a serious set to his mouth, and a formal bearing.',
    'He is dressed in a dark navy government uniform with a narrow tie and small gold lapel badge.',
    SHARED_FRAMING,
  ].join(' '),
  Crumb: [
    'Stylized 1970s Singaporean government-drama portrait of "Officer Crumb", a colorful hand-puppet character in an official role.',
    'Crumb is a whimsical fabric puppet with a shaggy round head, wide-set eyes mounted high on the face, deep-blue fuzzy felt texture, and an earnest expression.',
    'He is dressed in a dark navy government uniform with a slightly rumpled narrow tie and small gold lapel badge.',
    SHARED_FRAMING,
  ].join(' '),
};

const EXPRESSION_DESCRIPTORS = {
  strict:
    'formal and authoritative expression, brow lowered, eyes focused just past camera, lips pressed together, the composed look of a seasoned administrator.',
  warm:
    'subtly warm but still formal expression, faint suppressed half-smile, eyes slightly softened, head tilted a hair toward camera, dignified.',
  skeptical:
    'thoughtful and slightly skeptical expression, mouth a flat line, brow faintly furrowed, gaze just past camera as if carefully reviewing a document.',
  delighted:
    'rare controlled satisfaction — a pleased upturn at one corner of the mouth, eyes just brightened enough to notice, the look of a decision made.',
};

const CHARACTERS = ['Ernest', 'Bern', 'Crumb'];
const EXPRESSIONS = ['strict', 'warm', 'skeptical', 'delighted'];

const VARIANTS = CHARACTERS.flatMap((char) =>
  EXPRESSIONS.map((expr) => ({
    name: `officer-${char.toLowerCase()}-${expr}`,
    character: char,
    expression: expr,
  })),
);

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

function buildPrompt(character, expression) {
  const base = CHARACTER_BASE_PROMPTS[character] ?? CHARACTER_BASE_PROMPTS.Ernest;
  return `${base} Expression: ${EXPRESSION_DESCRIPTORS[expression]}`;
}

async function generateReplicateImage({ prompt, outPath }) {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error('REPLICATE_API_TOKEN missing');

  const REPLICATE_VERSION = '9ea921ca3eea597fe8773474545f54601fe1d30bc62517fb30fd86f42e4bb3cf';
  const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions';

  const resp = await fetch(REPLICATE_PREDICTIONS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait=60',
    },
    body: JSON.stringify({
      version: REPLICATE_VERSION,
      input: {
        prompt,
        aspect_ratio: '1:1',
        quality: 'auto',
        output_format: 'png',
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`replicate ${resp.status}: ${errText.slice(0, 500)}`);
  }

  let prediction = await resp.json();

  // Poll if not yet succeeded
  for (let attempt = 0; attempt < 8; attempt++) {
    if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') break;
    await new Promise((r) => setTimeout(r, 6000));
    const pollResp = await fetch(`${REPLICATE_PREDICTIONS_URL}/${prediction.id}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (pollResp.ok) prediction = await pollResp.json();
  }

  if (prediction.status !== 'succeeded' || !prediction.output?.length) {
    throw new Error(`replicate prediction failed: ${prediction.error ?? prediction.status}`);
  }

  const imgResp = await fetch(prediction.output[0]);
  if (!imgResp.ok) throw new Error(`image fetch failed: ${imgResp.status}`);
  const buf = Buffer.from(await imgResp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  return { bytes: buf.length, model: 'replicate/gpt-image-2' };
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

async function generateGeminiImage({ prompt, outPath }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY/GOOGLE_API_KEY missing');

  const candidates = [
    'gemini-3-pro-image-preview',
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
  throw lastError || new Error('All Gemini image attempts failed');
}

function svgFallback(character, expression) {
  const colors = { Ernest: '#e87020', Bern: '#d4c028', Crumb: '#1e4ac8' };
  const color = colors[character] ?? '#c9b7e8';
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
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#key)"/>
  <rect x="0" y="780" width="1024" height="244" fill="#3a2410"/>
  <ellipse cx="512" cy="900" rx="360" ry="180" fill="url(#uniform)"/>
  <path d="M380 760 L512 700 L644 760 L644 1024 L380 1024 Z" fill="url(#uniform)"/>
  <ellipse cx="512" cy="540" rx="170" ry="210" fill="${color}"/>
  <rect width="1024" height="1024" fill="url(#key)" opacity="0.4"/>
  <g font-family="Georgia, serif" fill="#caa64a" opacity="0.65">
    <text x="80" y="980" font-size="28" letter-spacing="6">OFFICER  ${character.toUpperCase()}  · ${expression.toUpperCase()}</text>
  </g>
</svg>`;
}

async function generateSvgFallback({ character, expression, outPath }) {
  const svg = svgFallback(character, expression);
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

  const prompt = buildPrompt(variant.character, variant.expression);
  const errors = [];

  // Primary: Replicate gpt-image-2
  try {
    const r = await generateReplicateImage({ prompt, outPath });
    const norm = await ensurePng(outPath).catch((e) => ({ transcoded: false, format: 'unknown', error: e.message }));
    const stat = await fs.stat(outPath);
    return { name: variant.name, status: 'ok', provider: `replicate:${r.model}`, bytes: stat.size, outPath, errors, normalized: norm };
  } catch (err) {
    errors.push(`replicate: ${err.message}`);
  }

  // Fallback 1: OpenAI gpt-image-1
  try {
    const r = await generateOpenAIImage({ prompt, outPath });
    const norm = await ensurePng(outPath).catch((e) => ({ transcoded: false, format: 'unknown', error: e.message }));
    const stat = await fs.stat(outPath);
    return { name: variant.name, status: 'ok', provider: `openai:${r.model}`, bytes: stat.size, outPath, errors, normalized: norm };
  } catch (err) {
    errors.push(`openai: ${err.message}`);
  }

  // Fallback 2: Gemini
  try {
    const r = await generateGeminiImage({ prompt, outPath });
    const norm = await ensurePng(outPath).catch((e) => ({ transcoded: false, format: 'unknown', error: e.message }));
    const stat = await fs.stat(outPath);
    return { name: variant.name, status: 'ok', provider: `gemini:${r.model}`, bytes: stat.size, outPath, errors, normalized: norm };
  } catch (err) {
    errors.push(`gemini: ${err.message}`);
  }

  // Last resort: SVG placeholder
  try {
    const r = await generateSvgFallback({ character: variant.character, expression: variant.expression, outPath });
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

  // Try to load from project .env first, then fallback to aether .env.local
  await loadDotenv(ENV_PATH);
  if (!process.env.REPLICATE_API_TOKEN) {
    await loadDotenv(path.join(path.dirname(REPO_ROOT), 'aether', '.env.local'));
  }

  await ensureDir(OUT_DIR);

  console.log(`Generating ${VARIANTS.length} officer avatars (3 characters × 4 expressions)...`);
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
      `  ${r.name.padEnd(32)} ${tag.padEnd(30)} ${r.bytes ?? 0} bytes${r.warning ? `  [${r.warning}]` : ''}`,
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
