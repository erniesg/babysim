/**
 * generate-baby-clips.mjs — pre-bake baby state-transition clips via Seedance 2.0 on Replicate.
 *
 * Usage:
 *   REPLICATE_API_TOKEN=r8_... node scripts/generate-baby-clips.mjs
 *   # Or with .env file (automatically loaded)
 *
 * Flags:
 *   --smoke          Run only the first transition (settled→hungry) to verify the API. No MP4 download.
 *   --skip-existing  Skip transitions where the output MP4 already exists (default on full run).
 *   --force          Re-generate even if the MP4 exists.
 *
 * Output:
 *   public/video/baby/{from}-to-{to}.mp4         (transition clips)
 *   public/video/baby/{state}-idle.mp4           (idle loops)
 *   public/video/baby/_index.json                (manifest of all generated clips)
 *
 * Concurrency: max 2 parallel Replicate jobs (to avoid rate limits).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'video', 'baby');

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions';
const REPLICATE_MODEL_VERSION =
  '4631ca9b77b48db08836df4527a436455c4eddff6b25dbc12e541f262aaab774';

// Base URL where the deployed Worker serves static assets from ./dist (which mirrors ./public).
const BASE_ASSET_URL = 'https://babysim.berlayar.ai/img/baby';

// ─── Clip definitions ─────────────────────────────────────────────────────────

/**
 * @typedef {{ type: 'transition', from: string, to: string, prompt: string, duration: number, generateAudio: boolean }
 *           | { type: 'idle',       state: string,                  prompt: string, duration: number, generateAudio: boolean }} ClipSpec
 */

/** @type {ClipSpec[]} */
const CLIPS = [
  // ── Transition clips (priority order) ──────────────────────────────────────
  {
    type: 'transition',
    from: 'settled',
    to: 'hungry',
    prompt:
      'Newborn baby gradually transitioning from settled contentment to hungry restlessness — eyes open wider, lips smack softly, tiny fists begin to clench. Slow zoom-in. Soft warm amber key light from upper-left. 1970s East Asian family drama aesthetic, painterly film grain, shallow depth of field.',
    duration: 5,
    generateAudio: true,
  },
  {
    type: 'transition',
    from: 'hungry',
    to: 'crying',
    prompt:
      'Newborn baby escalating from hungry fussing to full crying — face scrunches, mouth opens wide, small shoulders tense up, arms flail gently. Slow push-in. Warm amber low-key light. 1970s East Asian family drama aesthetic, painterly film grain.',
    duration: 5,
    generateAudio: true,
  },
  {
    type: 'transition',
    from: 'crying',
    to: 'fussy',
    prompt:
      'Newborn baby calming from full crying to residual fussiness after being soothed — tears still on cheeks, breathing slows, occasional hiccup, eyes searching. Slow pull-back. Soft warm low-key light. 1970s East Asian family drama aesthetic, painterly film grain.',
    duration: 5,
    generateAudio: true,
  },
  {
    type: 'transition',
    from: 'fussy',
    to: 'drowsy',
    prompt:
      'Newborn baby settling from fussy restlessness into drowsiness — eyelids growing heavy, tiny hands relaxing, breathing deepening, head lolling slightly. Gentle slow zoom-out. Warm amber light softening. 1970s East Asian family drama aesthetic, painterly film grain.',
    duration: 5,
    generateAudio: true,
  },
  {
    type: 'transition',
    from: 'drowsy',
    to: 'sleep',
    prompt:
      'Newborn baby drifting from drowsy half-sleep into deep sleep — eyes fluttering closed, face fully relaxed, lips parted in the tiniest pout, chest rising and falling slowly. Slow fade-dim. Warm amber low-key light. 1970s East Asian family drama aesthetic, painterly film grain.',
    duration: 5,
    generateAudio: true,
  },
  {
    type: 'transition',
    from: 'settled',
    to: 'drowsy',
    prompt:
      'Newborn baby yawning and transitioning from settled wakefulness to drowsiness — wide yawn, eyes scrunching then slowly reopening heavy-lidded, tiny fist rubbing cheek. Gentle slow zoom-in. Warm amber key light. 1970s East Asian family drama aesthetic, painterly film grain.',
    duration: 5,
    generateAudio: true,
  },

  // ── Idle loop clips (one per state, 5s, no last_frame_image) ────────────────
  {
    type: 'idle',
    state: 'settled',
    prompt:
      'Newborn baby in settled state, subtle breathing motion, chest rising and falling gently, eyes softly open and curious, tiny fingers curling slowly. Soft warm low-key light from upper-left. 1970s East Asian family drama aesthetic, painterly film grain. NO music, no talking, only ambient room tone and gentle breathing sounds.',
    duration: 5,
    generateAudio: false,
  },
  {
    type: 'idle',
    state: 'drowsy',
    prompt:
      'Newborn baby in drowsy state, eyes barely flickering half-open, subtle breathing motion, head swaying the tiniest amount, face slack and peaceful. Soft warm amber low-key light. 1970s East Asian family drama aesthetic, painterly film grain. NO music, no talking, only ambient breathing.',
    duration: 5,
    generateAudio: false,
  },
  {
    type: 'idle',
    state: 'hungry',
    prompt:
      'Newborn baby in hungry state, subtle rooting reflex — turning head side to side, lips smacking softly, arms stirring, mild restlessness, eyes intermittently open. Soft warm low-key light. 1970s East Asian family drama aesthetic, painterly film grain. NO music, only ambient fussing sounds.',
    duration: 5,
    generateAudio: false,
  },
  {
    type: 'idle',
    state: 'fussy',
    prompt:
      'Newborn baby in fussy state, intermittent small whimpers, brow furrowing and releasing, arms moving fitfully, face scrunching and relaxing. Soft warm low-key light. 1970s East Asian family drama aesthetic, painterly film grain. NO music, only soft fussing sounds.',
    duration: 5,
    generateAudio: false,
  },
  {
    type: 'idle',
    state: 'crying',
    prompt:
      'Newborn baby in crying state, continuous crying motion — mouth wide open, face red, small shoulders heaving, arms and legs kicking gently. Warm amber low-key light. 1970s East Asian family drama aesthetic, painterly film grain. NO music, only crying sounds.',
    duration: 5,
    generateAudio: false,
  },
  {
    type: 'idle',
    state: 'sleep',
    prompt:
      'Newborn baby in deep sleep state, absolutely still except for barely perceptible chest rise and fall, face completely relaxed, lips slightly parted, eyes firmly closed. Very soft warm amber low-key light. 1970s East Asian family drama aesthetic, painterly film grain. NO music, no talking, only ambient breathing.',
    duration: 5,
    generateAudio: false,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function clipKey(clip) {
  return clip.type === 'transition'
    ? `${clip.from}-to-${clip.to}`
    : `${clip.state}-idle`;
}

function clipFilename(clip) {
  return `${clipKey(clip)}.mp4`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Replicate API ────────────────────────────────────────────────────────────

async function initiatePrediction(clip, token) {
  const input = {
    prompt: clip.prompt,
    duration: clip.duration,
    resolution: '720p',
    aspect_ratio: '16:9',
    generate_audio: clip.generateAudio,
  };

  if (clip.type === 'transition') {
    input.image = `${BASE_ASSET_URL}/${clip.from}.png`;
    input.last_frame_image = `${BASE_ASSET_URL}/${clip.to}.png`;
  } else {
    // Idle loop: only start frame to seed appearance.
    input.image = `${BASE_ASSET_URL}/${clip.state}.png`;
  }

  const resp = await fetch(REPLICATE_PREDICTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'respond-async',
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`replicate initiate ${resp.status}: ${text.slice(0, 400)}`);
  }

  return /** @type {{ id: string, status: string, urls?: { get: string } }} */ (await resp.json());
}

async function pollUntilDone(predictionId, token, { label, intervalMs = 5000, timeoutMs = 300_000 } = {}) {
  const pollUrl = `${REPLICATE_PREDICTIONS_URL}/${predictionId}`;
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label}: timed out after ${timeoutMs / 1000}s`);
    }

    await sleep(intervalMs);

    const resp = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${label}: poll ${resp.status}: ${text.slice(0, 300)}`);
    }

    const prediction = await resp.json();
    const { status, output, error } = prediction;

    if (status === 'failed' || status === 'canceled') {
      throw new Error(`${label}: prediction ${status}: ${error ?? '(no error detail)'}`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r  ${label}: ${status} (${elapsed}s elapsed)...   `);

    if (status === 'succeeded') {
      process.stdout.write('\n');
      if (typeof output !== 'string') {
        throw new Error(`${label}: succeeded but output is not a string URL`);
      }
      return output; // Replicate delivery URL for the MP4
    }
  }
}

async function downloadMp4(videoUrl, outPath, label) {
  process.stdout.write(`  ${label}: downloading MP4...`);
  const resp = await fetch(videoUrl);
  if (!resp.ok) {
    throw new Error(`${label}: download ${resp.status} from ${videoUrl.slice(0, 80)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(outPath, buf);
  process.stdout.write(` ${buf.length} bytes\n`);
  return buf.length;
}

// ─── Per-clip generation ─────────────────────────────────────────────────────

/**
 * @param {ClipSpec} clip
 * @param {{ token: string, skipExisting: boolean, smokeOnly: boolean }} opts
 * @returns {Promise<{ key: string, status: 'ok'|'skipped'|'smoke_only', predictionId?: string, videoUrl?: string, videoPath?: string, bytes?: number, elapsedSec?: number, error?: string }>}
 */
async function generateClip(clip, { token, skipExisting, smokeOnly }) {
  const key = clipKey(clip);
  const filename = clipFilename(clip);
  const outPath = path.join(OUT_DIR, filename);
  const label = key;

  if (skipExisting && (await fileExists(outPath))) {
    const stat = await fs.stat(outPath);
    console.log(`  ${label}: skipped (exists, ${stat.size} bytes)`);
    return { key, status: 'skipped' };
  }

  const t0 = Date.now();
  console.log(`  ${label}: initiating prediction...`);

  const prediction = await initiatePrediction(clip, token);
  const predictionId = prediction.id;
  const predictionPageUrl = `https://replicate.com/p/${predictionId}`;

  console.log(`  ${label}: prediction ID ${predictionId}`);
  console.log(`  ${label}: monitor at ${predictionPageUrl}`);

  if (smokeOnly) {
    // Smoke test: just confirm the prediction was created, skip polling + download.
    console.log(`  ${label}: [smoke-only] prediction created — exiting before poll/download`);
    return {
      key,
      status: 'smoke_only',
      predictionId,
      predictionPageUrl,
      generatedAt: new Date().toISOString(),
    };
  }

  const videoUrl = await pollUntilDone(predictionId, token, { label });
  const bytes = await downloadMp4(videoUrl, outPath, label);

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${label}: done in ${elapsedSec}s`);

  return {
    key,
    status: 'ok',
    predictionId,
    predictionPageUrl,
    videoUrl,
    videoPath: `public/video/baby/${filename}`,
    bytes,
    elapsedSec: parseFloat(elapsedSec),
    generatedAt: new Date().toISOString(),
  };
}

// ─── Concurrency pool (cap at 2) ─────────────────────────────────────────────

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Index manifest ───────────────────────────────────────────────────────────

async function loadIndex(indexPath) {
  try {
    return JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {
    return [];
  }
}

async function saveIndex(indexPath, entries) {
  await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await loadDotenv(ENV_PATH);

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    console.error('REPLICATE_API_TOKEN is not set. Export it or add it to .env');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const smokeOnly = args.includes('--smoke');
  const force = args.includes('--force');
  const skipExisting = !force; // default: skip existing files unless --force

  await ensureDir(OUT_DIR);

  const indexPath = path.join(OUT_DIR, '_index.json');
  const existingIndex = await loadIndex(indexPath);
  const indexMap = new Map(existingIndex.map((e) => [e.key, e]));

  // Determine which clips to process.
  let targets = CLIPS;
  if (smokeOnly) {
    targets = [CLIPS[0]]; // settled→hungry only
    console.log('--- SMOKE TEST MODE: running settled→hungry only ---\n');
  } else {
    console.log(`--- Full run: ${CLIPS.length} clips (max 2 parallel) ---\n`);
  }

  const tasks = targets.map((clip) => async () => {
    try {
      return await generateClip(clip, { token, skipExisting, smokeOnly });
    } catch (err) {
      return { key: clipKey(clip), status: 'failed', error: err.message };
    }
  });

  const results = await runPool(tasks, smokeOnly ? 1 : 2);

  // Merge results back into the index.
  for (const result of results) {
    if (result && result.key && result.status !== 'skipped') {
      indexMap.set(result.key, {
        ...(indexMap.get(result.key) ?? {}),
        ...result,
      });
    }
  }

  if (!smokeOnly) {
    await saveIndex(indexPath, Array.from(indexMap.values()));
    console.log(`\n_index.json saved to ${indexPath}`);
  }

  // Summary
  console.log('\n--- Summary ---');
  for (const result of results) {
    if (!result) continue;
    const { key, status, predictionId, videoPath, bytes, elapsedSec, error, predictionPageUrl } =
      result;
    if (status === 'ok') {
      console.log(
        `  ${String(key).padEnd(22)} ok        ${String(bytes).padStart(9)} bytes  ${elapsedSec}s`,
      );
    } else if (status === 'smoke_only') {
      console.log(`  ${String(key).padEnd(22)} smoke_ok  predictionId=${predictionId}`);
      console.log(`  ${' '.repeat(22)}           monitor: ${predictionPageUrl}`);
    } else if (status === 'skipped') {
      console.log(`  ${String(key).padEnd(22)} skipped`);
    } else {
      console.log(`  ${String(key).padEnd(22)} FAILED    ${error ?? ''}`);
    }
  }

  const failed = results.filter((r) => r && r.status === 'failed');
  if (failed.length > 0) {
    console.error(`\n${failed.length} clip(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
