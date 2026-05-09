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

export type AdoptedRig = { manifest: string; baseDir: string };

type Props = {
  officerName: string;
  partnerName: string;
  onChoose: (kind: BabyKind, rig?: AdoptedRig) => void;
};

// Pool of pre-generated rigs — each is a directory under /puppets/ with a
// puppet.json manifest. Single rig today: full-frame photo-state cycle
// (settled / drowsy / hungry / fussy / crying / sleep).
const ADOPT_RIG_POOL: Array<{ id: string; manifest: string; baseDir: string }> = [
  {
    id: "ward-photoreal-v1",
    manifest: "/puppets/baby-photoreal-v1/puppet.json",
    baseDir: "/puppets/baby-photoreal-v1",
  },
];

export function AdoptOrGenerate({ officerName, partnerName: _partnerName, onChoose }: Props) {
  // Single rig today — adopt resolves to it directly. (Pool kept as a list so
  // adding more rigs is a one-line append.)
  const pick = ADOPT_RIG_POOL[0];

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
        <button
          className="adopt-card adopt-card-simple"
          onClick={() => onChoose("adopt", { manifest: pick.manifest, baseDir: pick.baseDir })}
        >
          <h3>Adopt</h3>
          <span className="adopt-card-meta">Instant · pre-generated ward</span>
        </button>

        <button
          className="adopt-card adopt-card-simple"
          onClick={() => onChoose("generate")}
        >
          <h3>Generate</h3>
          <span className="adopt-card-meta">~ 60 s · from your intake photo</span>
        </button>
      </div>
    </div>
  );
}
