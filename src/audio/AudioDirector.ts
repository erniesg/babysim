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

  unlock(): void {
    this.unlocked = true;
  }

  handle(msg: ServerMessage): void {
    if (msg.type === "play_audio") {
      this.play(msg.channel, msg.assetId, Boolean(msg.loop));
    } else if (msg.type === "stop_audio") {
      this.stop(msg.channel);
    }
  }

  private play(channel: Channel, assetId: string, loop: boolean): void {
    if (!this.unlocked) return;
    const url = ASSET_URLS[assetId];
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

  // Fire-and-forget one-shot SFX outside the channel-tracked map so it can't be cut by stop().
  playOneShot(assetId: string, volume = 0.85): void {
    if (!this.unlocked) return;
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
  }
}
