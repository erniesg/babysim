export const ASSETS = {
  babyImages: {
    settled: "assets/baby/previews/settled.png",
    drowsy: "assets/baby/previews/drowsy.png",
    hungry: "assets/baby/previews/hungry.png",
    fussy: "assets/baby/previews/fussy.png",
    crying: "assets/baby/previews/crying.png",
    sleep: "assets/baby/previews/sleep.png",
  },
  babyAudio: {
    hunger: "assets/audio/baby/hunger-gemini.wav",
    discomfort: "assets/audio/baby/discomfort-gemini.wav",
    tired: "assets/audio/baby/tired-gemini.wav",
    burp: "assets/audio/baby/burp-gemini.wav",
    coo: "assets/audio/baby/coo-gemini.wav",
  },
  revealVideo: null,
  cuteVideo: null,
} as const;

export const SOURCE_REFERENCES = {
  existingBabyPngSource: "public/img/baby/",
  existingBabyAudioSource: "public/audio/baby/",
  existingPuppetRig: "public/puppets/baby/",
} as const;

