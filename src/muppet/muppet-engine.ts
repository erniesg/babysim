import * as THREE from "three";

export type MuppetExpression = "strict" | "warm" | "skeptical" | "delighted";
export type MuppetGesture = "stamp" | "lean" | "nod" | "wave" | "none";

export type MuppetSayOptions = {
  text: string;
  expression?: MuppetExpression;
  gesture?: MuppetGesture;
  /**
   * Optional pre-rendered audio (ElevenLabs, OpenAI TTS, Gemini TTS, etc.). When present,
   * the muppet plays this URL instead of the browser SpeechSynthesis voice. Mouth-sync still
   * runs off the same speaking flag so it animates whether the audio is browser-synth or remote.
   */
  audioUrl?: string;
};

/**
 * MuppetCharacter identifies which Sesame-inspired puppet civil servant is on stage.
 * Ernest = Ernie-likeness (warm orange, mischievous), Bern = Bert-likeness (yellow, severe),
 * Crumb = Cookie-Monster-likeness (deep blue, chaotic-friendly).
 */
export type MuppetCharacter = "Ernest" | "Bern" | "Crumb";

/**
 * Backward-compatible alias: callers that still pass "Tan"/"Lim"/"Wong" are mapped to the
 * new character names at the setVoiceProfile call site so existing callers don't break.
 */
export type OfficerVoiceProfile = MuppetCharacter | "Tan" | "Lim" | "Wong";

export type MuppetController = {
  say(opts: MuppetSayOptions): Promise<void>;
  setExpression(expression: MuppetExpression): void;
  playGesture(gesture: MuppetGesture): void;
  /** @deprecated use setCharacter; legacy names "Tan"/"Lim"/"Wong" are remapped internally */
  setVoiceProfile(officer: OfficerVoiceProfile): void;
  setCharacter(character: MuppetCharacter): void;
  panicStop(): void;
  unlockSpeech(): void;
  dispose(): void;
};

type VoicePrefs = {
  voiceMatcher: RegExp;
  rate: number;
  pitch: number;
};

/** Per-character visual config for geometry tweaks. */
type CharacterVisualConfig = {
  /** Hex color for the skin/fur material. */
  skinColor: number;
  /** Hex color for the hair cap. */
  hairColor: number;
  /**
   * Scale multiplier applied to the eye group vertically — larger = rounder/more prominent eyes.
   * Ernest: normal. Bern: slightly squinted. Crumb: wide, mounted high.
   */
  eyeScaleY: number;
  /**
   * Y offset of the eye groups from the default 0.42 position.
   * Crumb's eyes ride high; Bern/Ernest stay near default.
   */
  eyeYOffset: number;
  /**
   * X spread of the eyes — Crumb's googly eyes ride wide.
   */
  eyeXSpread: number;
  /** Head sphere X scale — 1.0 is round, <1.0 is narrow (Bern tall oval), >1.0 is wide. */
  headScaleX: number;
  /** Head sphere Y scale — Bern is elongated vertically. */
  headScaleY: number;
  /**
   * Brow thickness scale for the brow bar geometry (BoxGeometry Y size multiplier).
   * Bern has a heavy mono-brow; Ernest and Crumb are lighter.
   */
  browThickness: number;
  /**
   * Whether to merge the two brows into a single mono-brow geometry (Bern).
   */
  monoBrow: boolean;
  /**
   * Nose scale — Crumb has a rounder/larger nose.
   */
  noseScale: number;
};

const CHARACTER_VISUAL: Record<MuppetCharacter, CharacterVisualConfig> = {
  // Ernest: Ernie-likeness — warm orange skin, round head, normal eyes, light brows, mischievous
  Ernest: {
    skinColor: 0xe87020,
    hairColor: 0x20201c,
    eyeScaleY: 1.0,
    eyeYOffset: 0.0,
    eyeXSpread: 0.39,
    headScaleX: 1.0,
    headScaleY: 1.0,
    browThickness: 1.0,
    monoBrow: false,
    noseScale: 1.0,
  },
  // Bern: Bert-likeness — yellow skin, tall narrow oval head, heavy mono-brow, small eyes
  Bern: {
    skinColor: 0xd4c028,
    hairColor: 0x20201c,
    eyeScaleY: 0.78,
    eyeYOffset: -0.04,
    eyeXSpread: 0.33,
    headScaleX: 0.82,
    headScaleY: 1.22,
    browThickness: 2.4,
    monoBrow: true,
    noseScale: 0.85,
  },
  // Crumb: Cookie-Monster-likeness — deep blue, round shaggy head, wide googly eyes mounted high
  Crumb: {
    skinColor: 0x1e4ac8,
    hairColor: 0x0d2a8a,
    eyeScaleY: 1.3,
    eyeYOffset: 0.14,
    eyeXSpread: 0.50,
    headScaleX: 1.05,
    headScaleY: 0.98,
    browThickness: 0.7,
    monoBrow: false,
    noseScale: 1.3,
  },
};

/** Map legacy Tan/Lim/Wong names to new character identities. */
const LEGACY_TO_CHARACTER: Record<string, MuppetCharacter> = {
  Tan: "Ernest",
  Lim: "Bern",
  Wong: "Crumb",
  "Officer Tan": "Ernest",
  "Officer Lim": "Bern",
  "Officer Wong": "Crumb",
};

const VOICE_PROFILES: Record<MuppetCharacter, VoicePrefs> = {
  // Ernest (Tan): playful mid-deep, mischievous — UK male timbre with a slight lilt
  Ernest: { voiceMatcher: /daniel|arthur/i, rate: 0.95, pitch: 0.92 },
  // Bern (Lim): stern, lower, slow — severe and humorless
  Bern: { voiceMatcher: /oliver|george/i, rate: 0.88, pitch: 0.72 },
  // Crumb (Wong): rumbling, chaotic-friendly — deep and slightly distracted
  Crumb: { voiceMatcher: /fred|alex/i, rate: 0.85, pitch: 0.65 },
};

type ExpressionRig = {
  browTilt: number;
  browY: number;
  eyeScaleY: number;
  headTilt: number;
};

const EXPRESSIONS: Record<MuppetExpression, ExpressionRig> = {
  strict: { browTilt: 0.28, browY: -0.03, eyeScaleY: 0.72, headTilt: -0.02 },
  warm: { browTilt: -0.08, browY: 0.05, eyeScaleY: 1.08, headTilt: 0.05 },
  skeptical: { browTilt: 0.38, browY: 0, eyeScaleY: 0.82, headTilt: 0.12 },
  delighted: { browTilt: -0.12, browY: 0.08, eyeScaleY: 1.22, headTilt: -0.08 },
};

/**
 * Per-character expression overrides. Only keys that differ from the base EXPRESSIONS
 * need to be listed; the engine merges them at setCharacter() time.
 * - Bern's "warm" is still fairly stern — brow barely lifts.
 * - Crumb's "strict" is more "distracted stare" than authority — head tilts sideways.
 */
const CHARACTER_EXPRESSIONS: Partial<Record<MuppetCharacter, Partial<Record<MuppetExpression, Partial<ExpressionRig>>>>> = {
  Bern: {
    warm: { browTilt: 0.12, browY: 0.01, eyeScaleY: 0.92, headTilt: 0.03 },
    delighted: { browTilt: 0.04, browY: 0.04, eyeScaleY: 1.05, headTilt: -0.04 },
  },
  Crumb: {
    strict: { browTilt: 0.14, browY: -0.01, eyeScaleY: 0.88, headTilt: 0.18 },
    warm: { browTilt: -0.06, browY: 0.07, eyeScaleY: 1.18, headTilt: 0.12 },
    delighted: { browTilt: -0.16, browY: 0.10, eyeScaleY: 1.35, headTilt: 0.22 },
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateSpeechMs(text: string): number {
  return clamp(text.length * 54, 1200, 5200);
}

export function createMuppetEngine(canvas: HTMLCanvasElement): MuppetController {
  const state = {
    speechUnlocked: false,
    speaking: false,
    speakingTime: 0,
    mouthOpen: 0,
    mouthPeak: 0,
    expression: { ...EXPRESSIONS.strict } as ExpressionRig,
    expressionTarget: { ...EXPRESSIONS.strict } as ExpressionRig,
    gazeX: 0,
    gazeY: 0,
    blinkTimer: 1.6,
    blinkPhase: -1,
    gesture: null as MuppetGesture | null,
    gestureTime: 0,
    rootBaseX: 0.35,
    rootScale: 0.72,
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x120808, 10, 28);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.25, 10.5);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let lastTime = performance.now();
  let rafId = 0;
  let speechToken = 0;
  let currentUtterance: SpeechSynthesisUtterance | null = null;
  let speechEndTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackAudioContext: AudioContext | null = null;
  let activeSayResolver: (() => void) | null = null;
  let voicePrefs: VoicePrefs = VOICE_PROFILES.Ernest;
  let currentCharacter: MuppetCharacter = "Ernest";

  // Lighting
  scene.add(new THREE.HemisphereLight(0xf7dfbd, 0x25110d, 0.78));
  const key = new THREE.SpotLight(0xffd39b, 4.4, 24, Math.PI / 4, 0.64, 1.15);
  key.position.set(-4, 6.4, 5.8);
  scene.add(key);
  const puppetSpotTarget = new THREE.Object3D();
  puppetSpotTarget.position.set(state.rootBaseX, -0.1, 1.2);
  scene.add(puppetSpotTarget);
  const puppetSpotlight = new THREE.SpotLight(0xffe1aa, 12, 19, Math.PI / 8.5, 0.36, 0.82);
  puppetSpotlight.position.set(2.4, 7.4, 6.1);
  puppetSpotlight.target = puppetSpotTarget;
  scene.add(puppetSpotlight);
  const rim = new THREE.PointLight(0x40b7a5, 4.2, 16);
  rim.position.set(6.2, 3.2, 3.3);
  scene.add(rim);

  // Stage
  const redMat = new THREE.MeshStandardMaterial({ color: 0x7f171c, roughness: 0.78 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd5a84e, metalness: 0.25, roughness: 0.36 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4c2317, roughness: 0.82 });
  const darkBgMat = new THREE.MeshStandardMaterial({ color: 0x160a07, roughness: 0.95 });

  const back = new THREE.Mesh(new THREE.PlaneGeometry(22, 14), darkBgMat);
  back.position.set(0, 0, -3.6);
  scene.add(back);
  const valance = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 0.35), redMat);
  valance.position.set(0, 5.5, -1.3);
  scene.add(valance);
  for (const x of [-7.7, 7.7]) {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(2.2, 9, 0.25), redMat);
    curtain.position.set(x, 1.2, -1.2);
    scene.add(curtain);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.045, 8, 24), goldMat);
    rope.position.set(x * 0.96, 0.25, -0.98);
    rope.scale.x = 0.72;
    scene.add(rope);
  }
  const topTrim = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.16, 0.28), goldMat);
  topTrim.position.set(0, 4.86, -0.96);
  scene.add(topTrim);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(8.3, 1.45, 1.25), woodMat);
  desk.position.set(0, -2.62, 1.35);
  scene.add(desk);
  const deskFront = new THREE.Mesh(new THREE.BoxGeometry(8.55, 0.28, 1.32), goldMat);
  deskFront.position.set(0, -1.92, 1.43);
  scene.add(deskFront);
  const deskStamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.32, 24), goldMat);
  deskStamp.position.set(2.7, -1.66, 2.02);
  scene.add(deskStamp);

  // Muppet
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9b7e8, roughness: 0.82 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x25384d, roughness: 0.78 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x20201c, roughness: 0.72 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xfff7ec, roughness: 0.38 });
  const eyeDarkMat = new THREE.MeshStandardMaterial({ color: 0x140c09, roughness: 0.6 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x360a16, roughness: 0.7 });
  const tongueMat = new THREE.MeshStandardMaterial({ color: 0xcc6677, roughness: 0.72 });

  const root = new THREE.Group();
  root.position.set(0, -0.85, 1.2);
  scene.add(root);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 1.15, 8, 22), shirtMat);
  torso.position.set(0, -1.36, 0);
  root.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.055, 8, 28), shirtMat);
  collar.position.set(0, -0.71, 0.08);
  collar.rotation.x = Math.PI / 2;
  root.add(collar);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.28, 0);
  root.add(headGroup);

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.88, 24, 16), mouthMat);
  mouth.scale.set(0.9, 0.55, 0.75);
  mouth.position.set(0, -0.1, 0.08);
  headGroup.add(mouth);

  const upperJaw = new THREE.Group();
  const lowerJaw = new THREE.Group();
  headGroup.add(upperJaw);
  headGroup.add(lowerJaw);

  const upper = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 22, 0, Math.PI * 2, 0, Math.PI / 2),
    skinMat,
  );
  upperJaw.add(upper);
  const lower = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 22, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    skinMat,
  );
  lowerJaw.add(lower);
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), tongueMat);
  tongue.scale.set(1.05, 0.18, 0.75);
  tongue.position.set(0, -0.38, 0.15);
  lowerJaw.add(tongue);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(1.04, 36, 14, 0, Math.PI * 2, 0, Math.PI / 3),
    hairMat,
  );
  hair.position.y = 0.03;
  upperJaw.add(hair);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 12), skinMat);
  nose.position.set(0, 0.1, 0.98);
  nose.scale.set(0.9, 1.1, 1.2);
  upperJaw.add(nose);

  function makeEye(side: number) {
    const group = new THREE.Group();
    group.position.set(side * 0.39, 0.42, 0.78);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.23, 22, 16), eyeMat);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 10), eyeDarkMat);
    pupil.position.set(0, 0, 0.17);
    group.add(eye, pupil);
    return { group, eye, pupil };
  }
  const leftEye = makeEye(-1);
  const rightEye = makeEye(1);
  upperJaw.add(leftEye.group, rightEye.group);

  function makeBrow(side: number) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.065, 0.075), eyeDarkMat);
    brow.position.set(side * 0.41, 0.73, 0.84);
    brow.rotation.z = side * -0.18;
    return brow;
  }
  const leftBrow = makeBrow(-1);
  const rightBrow = makeBrow(1);
  upperJaw.add(leftBrow, rightBrow);

  function makeArm(side: number) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.72, -1.05, 0.02);
    shoulder.rotation.z = side * 0.24;
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 6, 14), shirtMat);
    upperArm.position.y = -0.48;
    shoulder.add(upperArm);
    const lowerArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.55, 6, 14), skinMat);
    lowerArm.position.set(side * 0.06, -1.02, 0.02);
    shoulder.add(lowerArm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), skinMat);
    hand.position.set(side * 0.08, -1.38, 0.08);
    shoulder.add(hand);
    return shoulder;
  }
  const leftShoulder = makeArm(-1);
  const rightShoulder = makeArm(1);
  root.add(leftShoulder, rightShoulder);

  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.24, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xd5a84e, roughness: 0.35 }),
  );
  badge.position.set(-0.36, -1.08, 0.78);
  root.add(badge);

  /**
   * Apply per-character visual differentiation: head color, eye prominence,
   * brow style, head shape. Uses geometry scale + material color tweaks only
   * (no mesh swaps) so the existing rig stays intact.
   */
  function applyCharacterVisuals(character: MuppetCharacter) {
    const cfg = CHARACTER_VISUAL[character];

    // Skin color (upper + lower jaw halves + nose + arms/hands)
    skinMat.color.setHex(cfg.skinColor);

    // Hair cap color
    hairMat.color.setHex(cfg.hairColor);

    // Head shape: scale the upper and lower jaw spheres
    upper.scale.set(cfg.headScaleX, cfg.headScaleY, 1.0);
    lower.scale.set(cfg.headScaleX, cfg.headScaleY, 1.0);
    nose.scale.set(0.9 * cfg.noseScale, 1.1 * cfg.noseScale, 1.2 * cfg.noseScale);

    // Eye position: Y offset + X spread
    leftEye.group.position.set(-cfg.eyeXSpread, 0.42 + cfg.eyeYOffset, 0.78);
    rightEye.group.position.set(cfg.eyeXSpread, 0.42 + cfg.eyeYOffset, 0.78);
    // Eye base scale (blink logic multiplies eyeScaleY on top of this)
    leftEye.group.scale.set(1, cfg.eyeScaleY, 1);
    rightEye.group.scale.set(1, cfg.eyeScaleY, 1);

    if (cfg.monoBrow) {
      // Mono-brow: hide left/right individual brows; use the right brow as a wide center bar.
      leftBrow.visible = false;
      rightBrow.visible = true;
      rightBrow.position.set(0, 0.73, 0.84); // centered
      (rightBrow.geometry as THREE.BoxGeometry).dispose();
      // Re-create the geometry wide enough to span both eye positions
      const wideGeo = new THREE.BoxGeometry(0.82, 0.065 * cfg.browThickness, 0.075);
      (rightBrow as THREE.Mesh).geometry = wideGeo;
      rightBrow.rotation.z = 0.06; // slight downward V angle
    } else {
      leftBrow.visible = true;
      rightBrow.visible = true;
      // Restore independent brow geometry (normal width)
      (leftBrow.geometry as THREE.BoxGeometry).dispose();
      (rightBrow.geometry as THREE.BoxGeometry).dispose();
      (leftBrow as THREE.Mesh).geometry = new THREE.BoxGeometry(0.34, 0.065 * cfg.browThickness, 0.075);
      (rightBrow as THREE.Mesh).geometry = new THREE.BoxGeometry(0.34, 0.065 * cfg.browThickness, 0.075);
      leftBrow.position.set(-0.41, 0.73, 0.84);
      rightBrow.position.set(0.41, 0.73, 0.84);
      leftBrow.rotation.z = -0.18;
      rightBrow.rotation.z = 0.18;
    }
  }

  // Apply default character visuals on startup
  applyCharacterVisuals("Ernest");

  function resize() {
    const rect = canvas.getBoundingClientRect();
    // When the canvas is in a display:none ancestor, getBoundingClientRect
    // returns 0×0; sizing the renderer to that locks it in at 1×1 and the
    // muppet appears flat / invisible when the parent is shown later. Skip
    // sizing on zero-rects and rely on the ResizeObserver to retry on reveal.
    if (rect.width < 4 || rect.height < 4) return;
    const width = rect.width;
    const height = rect.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = width < 700 ? 12 : 10.5;
    camera.updateProjectionMatrix();
    const compact = width < 700;
    const narrow = width >= 700 && width < 980;
    state.rootBaseX = compact ? 0 : narrow ? 0.18 : 0.35;
    state.rootScale = compact ? 0.66 : narrow ? 0.68 : 0.72;
  }

  function onPointerMove(event: PointerEvent) {
    const x = event.clientX / window.innerWidth;
    const y = event.clientY / window.innerHeight;
    state.gazeX = (x - 0.5) * 2;
    state.gazeY = (y - 0.5) * 2;
  }
  function onResize() {
    resize();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove);

  // Watch the canvas itself so that toggling display:none ↔ display:block on
  // an ancestor triggers a re-fit. Critical for the muppet to render at full
  // size when its officer-beat container becomes visible.
  const sizeObserver = new ResizeObserver(() => resize());
  sizeObserver.observe(canvas);

  function updateBlink(dt: number) {
    state.blinkTimer -= dt;
    let blinkScale = 1;
    if (state.blinkPhase >= 0) {
      state.blinkPhase += dt;
      const t = state.blinkPhase / 0.13;
      blinkScale = t < 0.5 ? 1 - t * 1.9 : (t - 0.5) * 1.9;
      blinkScale = clamp(blinkScale, 0.06, 1);
      if (t >= 1) {
        state.blinkPhase = -1;
        state.blinkTimer = 1.8 + Math.random() * 3.1;
      }
    } else if (state.blinkTimer <= 0) {
      state.blinkPhase = 0;
    }
    const eyeY = state.expression.eyeScaleY * blinkScale;
    leftEye.group.scale.y = eyeY;
    rightEye.group.scale.y = eyeY;
  }

  function updateExpression() {
    leftBrow.position.y = 0.73 + state.expression.browY;
    rightBrow.position.y = 0.73 + state.expression.browY;
    leftBrow.rotation.z = -1 * -0.18 + state.expression.browTilt * -1;
    rightBrow.rotation.z = 1 * -0.18 + state.expression.browTilt * 1;
  }

  function updateGesture(dt: number) {
    leftShoulder.rotation.set(0, 0, -0.24);
    rightShoulder.rotation.set(0, 0, 0.24);
    deskStamp.rotation.set(0, 0, 0);
    deskStamp.position.y = -1.66;

    const idle = Math.sin(performance.now() * 0.0024) * 0.08;
    leftShoulder.rotation.z += idle;
    rightShoulder.rotation.z -= idle;

    if (!state.gesture || state.gesture === "none") return;
    state.gestureTime += dt;
    const t = state.gestureTime;
    const done = t > 1.15;
    const env = Math.sin(clamp(t / 1.15, 0, 1) * Math.PI);

    if (state.gesture === "wave") {
      rightShoulder.rotation.z -= 1.35 * env;
      rightShoulder.rotation.x += Math.sin(t * Math.PI * 8) * 0.45 * env;
    }
    if (state.gesture === "stamp") {
      deskStamp.position.y -= Math.sin(clamp(t / 0.55, 0, 1) * Math.PI) * 0.16;
      deskStamp.rotation.z += Math.sin(t * Math.PI * 8) * 0.12 * env;
      rightShoulder.rotation.z -= 0.85 * env;
    }
    if (state.gesture === "lean") {
      root.position.z = 1.2 + 0.48 * env;
    } else {
      root.position.z += (1.2 - root.position.z) * 0.12;
    }
    if (state.gesture === "nod") {
      headGroup.rotation.x += Math.sin(t * Math.PI * 5) * 0.18 * env;
    }
    if (done) {
      state.gesture = null;
      state.gestureTime = 0;
    }
  }

  function update(dt: number, now: number) {
    const k = 1 - Math.exp(-dt / 0.24);
    for (const ek of Object.keys(state.expression) as (keyof ExpressionRig)[]) {
      state.expression[ek] += (state.expressionTarget[ek] - state.expression[ek]) * k;
    }

    state.speakingTime += dt;
    const speechTarget = state.speaking ? 1 : 0;
    const pulse = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(state.speakingTime * Math.PI * 8.5));
    state.mouthOpen += (speechTarget * pulse - state.mouthOpen) * (1 - Math.exp(-dt / 0.08));
    state.mouthPeak = Math.max(state.mouthPeak, state.mouthOpen);

    lowerJaw.rotation.x = state.mouthOpen * 0.84;
    upperJaw.rotation.x = -state.mouthOpen * 0.22;

    const gx = clamp(state.gazeX, -1, 1);
    const gy = clamp(state.gazeY, -1, 1);
    headGroup.rotation.y = gx * 0.42;
    headGroup.rotation.x = -gy * 0.24 + state.mouthOpen * 0.03;
    headGroup.rotation.z = state.expression.headTilt;

    leftEye.pupil.position.x = gx * 0.045;
    rightEye.pupil.position.x = gx * 0.045;
    leftEye.pupil.position.y = -gy * 0.04;
    rightEye.pupil.position.y = -gy * 0.04;

    updateBlink(dt);
    updateExpression();
    updateGesture(dt);

    root.position.x = state.rootBaseX;
    root.scale.setScalar(state.rootScale);
    root.rotation.z = Math.sin(now * 0.0013) * 0.025 + state.expression.headTilt * 0.3;
    root.position.y = -0.85 + Math.sin(now * 0.0018) * 0.035;

    puppetSpotTarget.position.set(state.rootBaseX, -0.05, 1.2);
    puppetSpotlight.position.x = state.rootBaseX - 2.1;
  }

  function animate(now: number) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt, now);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }

  function setExpression(expression: MuppetExpression) {
    const base = EXPRESSIONS[expression] ?? EXPRESSIONS.strict;
    const charOverride = CHARACTER_EXPRESSIONS[currentCharacter]?.[expression] ?? {};
    state.expressionTarget = { ...base, ...charOverride };
  }

  function playGesture(gesture: MuppetGesture) {
    if (!gesture || gesture === "none") return;
    state.gesture = gesture;
    state.gestureTime = 0;
  }

  function unlockSpeech() {
    if (state.speechUnlocked) return;
    state.speechUnlocked = true;
    window.speechSynthesis?.resume?.();
    window.speechSynthesis?.getVoices?.();
  }

  function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
    return (
      english.find((v) => voicePrefs.voiceMatcher.test(v.name)) ||
      english.find((v) => /google|premium|enhanced/i.test(v.name)) ||
      english[0] ||
      voices[0] ||
      null
    );
  }

  function resolveCharacter(officer: OfficerVoiceProfile): MuppetCharacter {
    // Accept both new names (Ernest/Bern/Crumb) and legacy Tan/Lim/Wong
    if (officer === "Ernest" || officer === "Bern" || officer === "Crumb") return officer;
    return LEGACY_TO_CHARACTER[officer] ?? "Ernest";
  }

  function setCharacter(character: MuppetCharacter): void {
    currentCharacter = character;
    voicePrefs = VOICE_PROFILES[character] ?? VOICE_PROFILES.Ernest;
    applyCharacterVisuals(character);
  }

  /** @deprecated Use setCharacter; legacy Tan/Lim/Wong names are remapped internally. */
  function setVoiceProfile(officer: OfficerVoiceProfile): void {
    setCharacter(resolveCharacter(officer));
  }

  function stopSpeech() {
    if (speechEndTimer) clearTimeout(speechEndTimer);
    if (fallbackSpeechTimer) clearTimeout(fallbackSpeechTimer);
    speechEndTimer = null;
    fallbackSpeechTimer = null;
    currentUtterance = null;
    window.speechSynthesis?.cancel?.();
    state.speaking = false;
    if (activeSayResolver) {
      const r = activeSayResolver;
      activeSayResolver = null;
      r();
    }
  }

  function playFallbackChatter(duration: number) {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctx) return;
    if (!fallbackAudioContext) fallbackAudioContext = new Ctx();
    const ctx = fallbackAudioContext;
    ctx.resume?.();
    const now = ctx.currentTime;
    const pulses = Math.min(22, Math.max(5, Math.round(duration / 170)));
    for (let i = 0; i < pulses; i += 1) {
      const startT = now + i * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(190 + (i % 4) * 32, startT);
      gain.gain.setValueAtTime(0.0001, startT);
      gain.gain.exponentialRampToValueAtTime(0.045, startT + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, startT + 0.105);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startT);
      osc.stop(startT + 0.12);
    }
  }

  function audibleFallback(text: string, token: number, resolve: () => void) {
    if (token !== speechToken) {
      resolve();
      return;
    }
    const duration = estimateSpeechMs(text);
    state.speaking = true;
    state.mouthPeak = 0;
    playFallbackChatter(duration);
    if (fallbackSpeechTimer) clearTimeout(fallbackSpeechTimer);
    fallbackSpeechTimer = setTimeout(() => {
      if (token !== speechToken) {
        resolve();
        return;
      }
      state.speaking = false;
      activeSayResolver = null;
      resolve();
    }, duration);
  }

  function speakWithBrowserVoice(text: string, attempt: number, token: number, resolve: () => void) {
    if (token !== speechToken) {
      resolve();
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) {
      audibleFallback(text, token, resolve);
      return;
    }
    synth.resume?.();
    const voices = synth.getVoices();
    if (voices.length === 0 && attempt < 8) {
      setTimeout(() => speakWithBrowserVoice(text, attempt + 1, token, resolve), 125);
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = voicePrefs.rate;
    utter.pitch = voicePrefs.pitch;
    utter.volume = 1;
    const voice = pickVoice(voices);
    if (voice) utter.voice = voice;

    currentUtterance = utter;
    state.speaking = true;
    state.mouthPeak = 0;

    const endAfter = estimateSpeechMs(text) + 1600;
    if (speechEndTimer) clearTimeout(speechEndTimer);
    speechEndTimer = setTimeout(() => {
      if (token === speechToken && currentUtterance === utter) {
        state.speaking = false;
        activeSayResolver = null;
        resolve();
      }
    }, endAfter);

    utter.onstart = () => {
      if (token !== speechToken || currentUtterance !== utter) return;
      state.speaking = true;
      state.mouthPeak = 0;
    };
    utter.onend = () => {
      if (token !== speechToken || currentUtterance !== utter) return;
      if (speechEndTimer) clearTimeout(speechEndTimer);
      speechEndTimer = null;
      currentUtterance = null;
      state.speaking = false;
      activeSayResolver = null;
      resolve();
    };
    utter.onerror = () => {
      if (token !== speechToken || currentUtterance !== utter) return;
      if (attempt < 1) {
        currentUtterance = null;
        setTimeout(() => speakWithBrowserVoice(text, attempt + 1, token, resolve), 180);
        return;
      }
      audibleFallback(text, token, resolve);
    };

    try {
      synth.speak(utter);
    } catch {
      audibleFallback(text, token, resolve);
    }
  }

  function say(opts: MuppetSayOptions): Promise<void> {
    const { text, expression, gesture, audioUrl } = opts;
    if (expression) setExpression(expression);
    if (gesture) playGesture(gesture);
    if (!text && !audioUrl) return Promise.resolve();

    return new Promise((resolve) => {
      const token = ++speechToken;
      if (activeSayResolver) {
        const prev = activeSayResolver;
        activeSayResolver = null;
        prev();
      }
      stopSpeech();
      activeSayResolver = resolve;

      // Pre-rendered audio takes precedence: play it through HTMLAudioElement,
      // mark the muppet as speaking so mouth-sync animates, resolve on `ended`.
      if (audioUrl) {
        playRemoteAudio(audioUrl, token, resolve);
        return;
      }

      if (!("speechSynthesis" in window)) {
        audibleFallback(text, token, resolve);
        return;
      }
      speakWithBrowserVoice(text, 0, token, resolve);
    });
  }

  let activeRemoteAudio: HTMLAudioElement | null = null;

  function playRemoteAudio(url: string, token: number, resolve: () => void) {
    if (token !== speechToken) {
      resolve();
      return;
    }
    const a = new Audio(url);
    a.volume = 1;
    activeRemoteAudio = a;
    state.speaking = true;
    state.mouthPeak = 0;
    const finish = () => {
      if (token !== speechToken) return;
      state.speaking = false;
      activeRemoteAudio = null;
      activeSayResolver = null;
      resolve();
    };
    a.addEventListener("ended", finish);
    a.addEventListener("error", finish);
    a.play().catch(() => {
      // Autoplay blocked or audio decode failed — resolve immediately so the beat advances.
      finish();
    });
  }

  function panicStop() {
    speechToken += 1;
    stopSpeech();
    if (activeRemoteAudio) {
      activeRemoteAudio.pause();
      activeRemoteAudio.src = "";
      activeRemoteAudio = null;
    }
    state.speaking = false;
    state.gesture = null;
    state.gestureTime = 0;
    setExpression("strict");
  }

  function dispose() {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    sizeObserver.disconnect();
    panicStop();
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      }
    });
  }

  resize();
  rafId = requestAnimationFrame(animate);

  return { say, setExpression, playGesture, setVoiceProfile, setCharacter, panicStop, unlockSpeech, dispose };
}
