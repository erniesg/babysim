import "./CutePayoff.css";

type Props = {
  babyName: string;
};

const SPARKLE_COUNT = 14;

export function CutePayoff({ babyName }: Props) {
  return (
    <div className="cute-payoff" aria-label="Cute moment">
      <div className="cute-stage">
        <div className="cute-baby">😊</div>
        <div className="cute-caption">{babyName || "She"} smiled at you.</div>
        <div className="cute-sparkles" aria-hidden="true">
          {Array.from({ length: SPARKLE_COUNT }).map((_, i) => (
            <span
              key={i}
              className="sparkle"
              style={{
                left: `${(i / SPARKLE_COUNT) * 100}%`,
                animationDelay: `${(i % 5) * 0.18}s`,
                animationDuration: `${2.4 + (i % 3) * 0.4}s`,
              }}
            >
              {i % 3 === 0 ? "✨" : i % 3 === 1 ? "💛" : "🌟"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
