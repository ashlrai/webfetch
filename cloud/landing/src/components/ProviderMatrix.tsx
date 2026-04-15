import { FadeUp } from "./FadeUp";

type Auth = "none" | "key" | "oauth" | "cloud";
type Stamp = "CC0" | "CC-BY" | "CC-BY-SA" | "PUBLIC DOMAIN" | "EDITORIAL" | "MIXED" | "UNKNOWN";

type Provider = {
  name: string;
  stamp: Stamp;
  auth: Auth;
  rate: string;
  optIn?: boolean;
  docs?: string;
};

const PROVIDERS: Provider[] = [
  { name: "wikimedia", stamp: "CC-BY-SA", auth: "none", rate: "generous" },
  { name: "openverse", stamp: "CC-BY", auth: "none", rate: "generous" },
  { name: "unsplash", stamp: "CC0", auth: "key", rate: "50/hr" },
  { name: "pexels", stamp: "CC0", auth: "key", rate: "200/hr" },
  { name: "pixabay", stamp: "CC0", auth: "key", rate: "100/min" },
  { name: "nasa", stamp: "PUBLIC DOMAIN", auth: "key", rate: "1000/hr" },
  { name: "smithsonian", stamp: "CC0", auth: "key", rate: "generous" },
  { name: "europeana", stamp: "MIXED", auth: "key", rate: "generous" },
  { name: "met-museum", stamp: "CC0", auth: "none", rate: "80/sec" },
  { name: "loc", stamp: "PUBLIC DOMAIN", auth: "none", rate: "generous" },
  { name: "flickr-cc", stamp: "CC-BY", auth: "key", rate: "3600/hr" },
  { name: "rijksmuseum", stamp: "PUBLIC DOMAIN", auth: "key", rate: "10k/day" },
  { name: "nypl", stamp: "PUBLIC DOMAIN", auth: "key", rate: "generous" },
  { name: "harvard-art", stamp: "CC0", auth: "key", rate: "generous" },
  { name: "itunes", stamp: "EDITORIAL", auth: "none", rate: "20/min" },
  { name: "musicbrainz-caa", stamp: "EDITORIAL", auth: "none", rate: "1/sec" },
  { name: "spotify", stamp: "EDITORIAL", auth: "oauth", rate: "180/min" },
  { name: "youtube-thumb", stamp: "EDITORIAL", auth: "none", rate: "generous" },
  { name: "bandcamp", stamp: "EDITORIAL", auth: "none", rate: "generous" },
  { name: "deezer", stamp: "EDITORIAL", auth: "none", rate: "50/5sec" },
  { name: "brave", stamp: "UNKNOWN", auth: "key", rate: "2k/mo", optIn: true },
  { name: "bing", stamp: "UNKNOWN", auth: "key", rate: "3/sec", optIn: true },
  { name: "serpapi", stamp: "UNKNOWN", auth: "key", rate: "100/mo", optIn: true },
  { name: "browser", stamp: "UNKNOWN", auth: "cloud", rate: "paid", optIn: true },
];

function stampClass(s: Stamp) {
  if (s === "CC0" || s === "PUBLIC DOMAIN") return "wf-stamp wf-stamp--green";
  return "wf-stamp";
}

function AuthIcon({ auth }: { auth: Auth }) {
  // small monoglyphs
  const map: Record<Auth, string> = {
    none: "●",
    key: "⚷",
    oauth: "◎",
    cloud: "☁",
  };
  const tooltip: Record<Auth, string> = {
    none: "no auth",
    key: "api key",
    oauth: "oauth",
    cloud: "cloud (managed)",
  };
  return (
    <span
      title={tooltip[auth]}
      className="inline-flex items-center justify-center w-5 h-5 rounded border border-[var(--color-border)] text-[11px] text-[var(--color-fg-dim)] font-mono"
    >
      {map[auth]}
    </span>
  );
}

export function ProviderMatrix() {
  return (
    <section id="providers" className="max-w-6xl mx-auto px-6 py-20 md:py-24">
      <FadeUp>
        <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
          — providers
        </div>
        <div className="flex items-end justify-between flex-wrap gap-4">
          <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] max-w-3xl">
            24 federated providers.
            <br />
            <span className="text-[var(--color-fg-dim)]">One ranked stream.</span>
          </h2>
          <div className="text-[12px] font-mono text-[var(--color-fg-dim)]">
            licensed → editorial → opt-in web
          </div>
        </div>
        <p className="mt-4 text-[var(--color-fg-dim)] max-w-2xl leading-relaxed">
          Licensed sources rank first. Editorial-licensed sources next. UNKNOWN providers are
          strictly opt-in and always emit an attribution sidecar.
        </p>
        <p className="mt-2 text-[13px] font-mono text-[var(--color-fg-faint)] max-w-2xl leading-relaxed">
          Every result carries a real license, sourced from a real provider, with a real link back
          to the original.
        </p>
      </FadeUp>

      <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {PROVIDERS.map((p, i) => (
          <FadeUp key={p.name} delay={Math.min(i, 12) * 18}>
            <div className="group relative wf-card p-4 h-full flex flex-col justify-between min-h-[112px] overflow-hidden">
              <span className={stampClass(p.stamp)} style={{ fontSize: 8 }}>
                {p.stamp}
              </span>
              <div className="font-mono text-[13px] text-[var(--color-fg)] pr-12 break-all">
                {p.name}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <AuthIcon auth={p.auth} />
                <span className="text-[10px] font-mono text-[var(--color-fg-dim)]">{p.rate}</span>
              </div>
              {p.optIn && (
                <span className="absolute bottom-1.5 left-3 text-[9px] font-mono text-[var(--color-amber)] uppercase tracking-wider">
                  opt-in
                </span>
              )}
            </div>
          </FadeUp>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-4 text-[11px] font-mono text-[var(--color-fg-dim)]">
        <Legend color="var(--color-green)" label="CC0 / PUBLIC DOMAIN" />
        <Legend color="var(--stamp-ink)" label="CC-BY / CC-BY-SA / EDITORIAL" />
        <Legend color="var(--color-amber)" label="opt-in — UNKNOWN + sidecar" />
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
