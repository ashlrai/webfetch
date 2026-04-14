const ROWS = [
  ["wikimedia", "none", "CC_BY_SA", "no", "generous"],
  ["openverse", "none", "CC_BY", "no", "generous"],
  ["unsplash", "key", "Unsplash (~CC0)", "no", "50/hr dev"],
  ["pexels", "key", "Pexels (~CC0)", "no", "200/hr"],
  ["pixabay", "key", "Pixabay (~CC0)", "no", "100/min"],
  ["nasa", "key", "PUBLIC_DOMAIN", "no", "1000/hr"],
  ["smithsonian", "key", "CC0", "no", "generous"],
  ["europeana", "key", "CC metadata", "no", "generous"],
  ["met-museum", "none", "CC0 (OA)", "no", "80/sec"],
  ["loc", "none", "PUBLIC_DOMAIN", "no", "generous"],
  ["flickr-cc", "key", "CC (varies)", "no", "3600/hr"],
  ["itunes", "none", "EDITORIAL_LICENSED", "no", "20/min"],
  ["musicbrainz-caa", "none", "EDITORIAL_LICENSED", "no", "1/sec"],
  ["spotify", "oauth", "EDITORIAL_LICENSED", "no", "180/min"],
  ["youtube-thumb", "none", "EDITORIAL_LICENSED", "no", "generous"],
  ["brave", "key", "UNKNOWN + heuristic", "no", "2000/mo free"],
  ["bing", "key", "UNKNOWN + heuristic", "yes", "3/sec"],
  ["serpapi", "key", "UNKNOWN + heuristic", "yes", "100/mo free"],
  ["browser", "cloud", "UNKNOWN + sidecar", "yes", "paid tier"],
];

export function ProviderMatrix() {
  return (
    <section id="providers" className="max-w-6xl mx-auto px-6 py-20">
      <h2 className="text-3xl font-semibold tracking-tight mb-3">19+ federated providers</h2>
      <p className="text-[var(--fg-dim)] mb-8 max-w-2xl">
        Licensed sources first. Web search providers are flagged. Browser fallback is strictly
        opt-in and emits an attribution sidecar on every result.
      </p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-elev)] text-left text-[var(--fg-dim)]">
            <tr>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Auth</th>
              <th className="px-4 py-3 font-medium">Default license</th>
              <th className="px-4 py-3 font-medium">Opt-in</th>
              <th className="px-4 py-3 font-medium">Rate limit</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([provider, auth, lic, optIn, rate]) => (
              <tr key={provider} className="border-t border-[var(--border)] hover:bg-[var(--bg-elev)]">
                <td className="px-4 py-2.5 font-mono text-[var(--accent)]">{provider}</td>
                <td className="px-4 py-2.5 text-[var(--fg-dim)]">{auth}</td>
                <td className="px-4 py-2.5">{lic}</td>
                <td className="px-4 py-2.5 text-[var(--fg-dim)]">{optIn}</td>
                <td className="px-4 py-2.5 text-[var(--fg-dim)]">{rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
