import "./TimeProgressBar.css";

/**
 * TimeProgressBar — 24-hour day clock as a horizontal progress bar.
 *
 * The simulator advances `currentHour` by 1 every `realSecondsPerGameHour`
 * seconds (default 3 s = ~72 s real time per 24 h game day). Bar fills 0–100%
 * across the day with hour ticks. Sun + moon icons mark day/night.
 */

type Props = {
  currentHour: number;
  timeLabel: string;
};

export function TimeProgressBar({ currentHour, timeLabel }: Props) {
  const hourMod = ((currentHour % 24) + 24) % 24;
  const pct = (hourMod / 24) * 100;
  const isNight = hourMod < 6 || hourMod >= 20;

  return (
    <div className={`time-bar ${isNight ? "night" : "day"}`}>
      <div className="time-bar-head">
        <span className="time-bar-icon" aria-hidden="true">
          {isNight ? "🌙" : "☀️"}
        </span>
        <span className="time-bar-label">Day {Math.floor(currentHour / 24) + 1} · {timeLabel}</span>
      </div>
      <div className="time-bar-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        {/* Fixed hour ticks at 6, 12, 18, 0 (24) */}
        {[6, 12, 18].map((h) => (
          <span
            key={h}
            className="time-bar-tick"
            style={{ left: `${(h / 24) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <div className="time-bar-fill" style={{ width: `${pct}%` }} />
        <span
          className="time-bar-marker"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
