import { useEffect, useState } from "react";
import "./AdoptOrGenerate.css";

/**
 * AdoptOrGenerate — chooser shown at baby_roll beat. Officer asks the player
 * whether they want to ADOPT a pre-generated baby (random pick from a gacha
 * pool) or GENERATE a fresh one (live `gpt-image-2` portrait based on the
 * player + partner photo).
 *
 * Generate is async and can take 60-90 s — kicks off the request the moment
 * the player commits, then advances to the name form. The portrait URL
 * resolves into the BabyVisual via `babyPortraitUrl` when ready.
 */

export type BabyKind = "adopt" | "generate";

type Props = {
  officerName: string;
  partnerName: string;
  onChoose: (kind: BabyKind) => void;
};

// Pool of pre-generated rigs — each is a directory under /puppets/ with its
// own face_backplate + 6 expression layer sets. Today only the canonical
// rig exists; adding more is just dropping a sibling dir.
const ADOPT_RIG_POOL: Array<{ id: string; faceBackplate: string; manifest: string; baseDir: string }> = [
  {
    id: "ward-001",
    faceBackplate: "/puppets/baby/layers/face_backplate.png",
    manifest: "/puppets/baby/puppet.json",
    baseDir: "/puppets/baby",
  },
];

export function AdoptOrGenerate({ officerName, partnerName: _partnerName, onChoose }: Props) {
  // Pick a random rig preview so each game feels fresh once the pool grows.
  const [adoptPreview, setAdoptPreview] = useState<string>(ADOPT_RIG_POOL[0].faceBackplate);

  useEffect(() => {
    const pick = ADOPT_RIG_POOL[Math.floor(Math.random() * ADOPT_RIG_POOL.length)];
    setAdoptPreview(pick.faceBackplate);
  }, []);

  return (
    <div className="adopt-generate">
      <div className="adopt-generate-prompt">
        <span className="kicker">{officerName}</span>
        <p className="adopt-generate-quote">
          "Two paths. The Ministry will assign one of our wards
          {" "}— the gacha pool — or generate a child algorithmically from
          your intake photo. Decide now."
        </p>
      </div>

      <div className="adopt-generate-cards">
        <button className="adopt-card" onClick={() => onChoose("adopt")}>
          <div className="adopt-card-art">
            <img src={adoptPreview} alt="" draggable={false} />
            <span className="adopt-card-tag">Adopt</span>
          </div>
          <div className="adopt-card-body">
            <h3>Adopt from the pool</h3>
            <p>A pre-generated ward, fully ready. Faster start, less personalized.</p>
            <span className="adopt-card-meta">Instant · curated traits</span>
          </div>
        </button>

        <button className="adopt-card" onClick={() => onChoose("generate")}>
          <div className="adopt-card-art adopt-card-art-gen">
            <span className="adopt-card-glyph" aria-hidden="true">✨</span>
            <span className="adopt-card-tag">Generate</span>
          </div>
          <div className="adopt-card-body">
            <h3>Generate from your file</h3>
            <p>Live portrait composed from your intake photo. Takes a moment to render.</p>
            <span className="adopt-card-meta">~ 60 s · personalized</span>
          </div>
        </button>
      </div>
    </div>
  );
}
