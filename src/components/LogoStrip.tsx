import "./LogoStrip.css";

/**
 * LogoStrip — looping carousel of provider/partner logos under the MFH badge.
 *
 * Logos are SVG so they're transparent + scale cleanly. Animation is a CSS
 * marquee that duplicates the list inline so the transform-translate loop
 * is seamless. `currentColor` is set in CSS so monochrome logos pick up the
 * stage's gold tone; full-color logos (Google, Gemini) ignore it.
 */

const LOGOS: Array<{ src: string; alt: string; mono?: boolean }> = [
  { src: "/img/logos/openai.svg", alt: "OpenAI", mono: true },
  { src: "/img/logos/codex.svg", alt: "Codex", mono: true },
  { src: "/img/logos/cloudflare.svg", alt: "Cloudflare" },
  { src: "/img/logos/google.svg", alt: "Google" },
  { src: "/img/logos/gemini.svg", alt: "Google Gemini" },
  { src: "/img/logos/elevenlabs.svg", alt: "ElevenLabs", mono: true },
];

export function LogoStrip() {
  return (
    <div className="logo-strip" aria-label="Powered by">
      <div className="logo-track">
        {/* Two copies of the list so the marquee can translate -50% and loop seamlessly. */}
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1 ? "true" : undefined}>
            {LOGOS.map((logo) => (
              <li
                key={`${copy}-${logo.alt}`}
                className={logo.mono ? "logo-mono" : "logo-color"}
              >
                <img src={logo.src} alt={logo.alt} draggable={false} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
