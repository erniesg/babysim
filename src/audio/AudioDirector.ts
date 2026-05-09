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
const LIVE_BABY_SFX = import.meta.env.VITE_LIVE_BABY_SFX === "1";
const LIVE_MUSIC = import.meta.env.VITE_LIVE_MUSIC === "1";

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

  private async play(channel: Channel, assetId: string, loop: boolean): Promise<void> {
    if (!this.unlocked) return;

    const url = await this.resolveUrl(assetId);
    if (!url) return;

    this.stop(channel);
    const el = new Audio(url);
    el.loop = loop;
    el.volume = CHANNEL_VOLUME[channel] ?? 0.6;
    el.play().catch(() => {
      // Autoplay rejected or file missing — silent fail keeps the demo running.
    });
    this.elements[channel] = el;
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
        el?.pause();
        if (el) el.currentTime = 0;
        delete this.elements[ch];
      }
      return;
    }
    const el = this.elements[target];
    if (el) {
      el.pause();
      el.currentTime = 0;
      delete this.elements[target];
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
