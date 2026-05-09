import type { ServerMessage } from "@contracts/messages";
import type { AudioChannel } from "@contracts/director-commands";

const ASSET_URLS: Record<string, string> = {
  "babyAudio.hunger": "/audio/baby/hunger.mp3",
  "babyAudio.tired": "/audio/baby/tired.mp3",
  "babyAudio.discomfort": "/audio/baby/discomfort.mp3",
  "babyAudio.coo": "/audio/baby/coo.mp3",
  "babyAudio.burp": "/audio/baby/coo.mp3",
  "music.probation_theme": "/audio/music/probation-theme.mp3",
  "sfx.snap": "/audio/sfx/snap.mp3",
};

// Map from assetId → trigger string for the /api/baby/sfx endpoint.
// Only the four synthesizable baby sounds are included; burp reuses coo prompt.
const BABY_SFX_TRIGGER: Record<string, string> = {
  "babyAudio.hunger": "hunger",
  "babyAudio.tired": "tired",
  "babyAudio.discomfort": "discomfort",
  "babyAudio.coo": "coo",
  "babyAudio.burp": "coo",
};

// Env flags — Vite exposes VITE_* vars through import.meta.env at build time.
// Live baby SFX (ElevenLabs text_to_sound_v2) stays opt-in — the same-baby-pack
// pre-baked recordings sound better and don't burn API budget per cry. Set
// VITE_LIVE_BABY_SFX=1 to enable.
const LIVE_BABY_SFX = import.meta.env.VITE_LIVE_BABY_SFX === "1";
// Live music (Lyria-002 via Vertex AI) is default ON — the dynamic theme is
// the product. Falls back to /audio/music/probation-theme.mp3 silently if the
// call fails or the GOOGLE_SERVICE_ACCOUNT_JSON secret is unset. Disable via
// VITE_LIVE_MUSIC=0.
const LIVE_MUSIC = import.meta.env.VITE_LIVE_MUSIC !== "0" && import.meta.env.VITE_LIVE_MUSIC !== "false";

const CHANNEL_VOLUME: Partial<Record<AudioChannel, number>> = {
  baby: 0.6,
  partner: 0.85,
  officer: 0.85,
  ambient: 0.32,
};

type Channel = AudioChannel;

export class AudioDirector {
  private elements: Partial<Record<Channel, HTMLAudioElement>> = {};
  private unlocked = false;

  // Cache of blob URLs fetched from live endpoints, keyed by assetId.
  // Revoked in dispose() to avoid memory leaks.
  private liveBlobUrls: Map<string, string> = new Map();

  unlock(): void {
    this.unlocked = true;
  }

  handle(msg: ServerMessage): void {
    if (msg.type === "play_audio") {
      void this.play(msg.channel, msg.assetId, Boolean(msg.loop));
    } else if (msg.type === "stop_audio") {
      this.stop(msg.channel);
    }
  }

  // Track which assetId is currently playing on each channel so we can
  // ignore redundant "play same asset, same loop" calls (the engine's tick
  // loop fires play_audio every game-hour while the cry persists).
  private playing: Partial<Record<Channel, { assetId: string; loop: boolean }>> = {};

  private fadeTo(el: HTMLAudioElement, target: number, durMs: number, onDone?: () => void) {
    const start = performance.now();
    const startVol = el.volume;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durMs);
      el.volume = startVol + (target - startVol) * t;
      if (t < 1) {
        requestAnimationFrame(step);
      } else if (onDone) {
        onDone();
      }
    };
    requestAnimationFrame(step);
  }

  private async play(channel: Channel, assetId: string, loop: boolean): Promise<void> {
    if (!this.unlocked) return;

    // Skip if the same asset is already looping on the same channel — avoids
    // restarting the cry every engine tick.
    const cur = this.playing[channel];
    if (cur && cur.assetId === assetId && cur.loop === loop && this.elements[channel]) return;

    const url = await this.resolveUrl(assetId);
    if (!url) return;

    const targetVol = CHANNEL_VOLUME[channel] ?? 0.6;

    // Fade-out any current element on this channel (don't cut abruptly).
    const prev = this.elements[channel];
    if (prev) {
      const oldEl = prev;
      this.fadeTo(oldEl, 0, 240, () => {
        oldEl.pause();
        oldEl.src = "";
      });
    }

    const el = new Audio(url);
    el.loop = loop;
    el.volume = 0;
    el.play().catch(() => {
      // Autoplay rejected or file missing — silent fail keeps the demo running.
    });
    this.elements[channel] = el;
    this.playing[channel] = { assetId, loop };
    // Fade in over 300ms so state-cycling between cry sounds doesn't pop.
    this.fadeTo(el, targetVol, 300);
  }

  // Resolve the URL to use for a given assetId.
  // Returns a live blob URL when the relevant flag is on and the fetch succeeds,
  // otherwise returns the pre-baked static URL (or undefined for unknown assets).
  private async resolveUrl(assetId: string): Promise<string | undefined> {
    // --- Live baby SFX path ---
    if (LIVE_BABY_SFX && assetId in BABY_SFX_TRIGGER) {
      const cached = this.liveBlobUrls.get(assetId);
      if (cached) return cached;

      const trigger = BABY_SFX_TRIGGER[assetId];
      console.log(`[AudioDirector] live fetch ${assetId} (trigger=${trigger})`);
      try {
        const res = await fetch("/api/baby/sfx", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trigger }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.liveBlobUrls.set(assetId, blobUrl);
          return blobUrl;
        }
        console.warn(`[AudioDirector] live sfx non-ok ${res.status}, falling back`);
      } catch (err) {
        console.warn("[AudioDirector] live sfx fetch failed, falling back", err);
      }
      // Fall through to pre-baked URL.
    }

    // --- Live music path ---
    if (LIVE_MUSIC && assetId === "music.probation_theme") {
      const cached = this.liveBlobUrls.get(assetId);
      if (cached) return cached;

      console.log(`[AudioDirector] live fetch ${assetId} (vibe=intro)`);
      try {
        const res = await fetch("/api/music/probation-theme", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vibe: "intro" }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.liveBlobUrls.set(assetId, blobUrl);
          return blobUrl;
        }
        console.warn(`[AudioDirector] live music non-ok ${res.status}, falling back`);
      } catch (err) {
        console.warn("[AudioDirector] live music fetch failed, falling back", err);
      }
      // Fall through to pre-baked URL.
    }

    // --- Pre-baked fallback ---
    return ASSET_URLS[assetId];
  }

  /**
   * Kick off a live-asset fetch in the background so its blob URL is cached
   * by the time `play()` is called. Use at game start for assets we know we'll
   * play later (e.g. probation-theme music at finger-snap) — otherwise the
   * Lyria call's 20–60 s latency would beat the cinematic timing.
   *
   * Safe to call multiple times — second call resolves to cached URL instantly.
   * Returns a promise that resolves when the prefetch completes (or when the
   * fetch falls back to the pre-baked URL).
   */
  prefetch(assetId: string): Promise<void> {
    return this.resolveUrl(assetId).then(() => {
      /* result discarded — side-effect populates liveBlobUrls cache */
    });
  }

  // Fire-and-forget one-shot SFX outside the channel-tracked map so it can't be cut by stop().
  playOneShot(assetId: string, volume = 0.85): void {
    if (!this.unlocked) return;
    // One-shots always use pre-baked URLs to avoid async latency for snaps/sfx.
    const url = ASSET_URLS[assetId];
    if (!url) return;
    const el = new Audio(url);
    el.volume = volume;
    el.play().catch(() => {});
  }

  private stop(target: Channel | "all"): void {
    if (target === "all") {
      for (const ch of Object.keys(this.elements) as Channel[]) {
        const el = this.elements[ch];
        if (!el) continue;
        this.fadeTo(el, 0, 220, () => {
          el.pause();
          el.currentTime = 0;
        });
        delete this.elements[ch];
        delete this.playing[ch];
      }
      return;
    }
    const el = this.elements[target];
    if (el) {
      this.fadeTo(el, 0, 220, () => {
        el.pause();
        el.currentTime = 0;
      });
      delete this.elements[target];
      delete this.playing[target];
    }
  }

  dispose(): void {
    this.stop("all");
    // Revoke all cached blob URLs to free memory.
    for (const blobUrl of this.liveBlobUrls.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.liveBlobUrls.clear();
  }
}
