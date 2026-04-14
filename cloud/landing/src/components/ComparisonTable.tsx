const COLS = [
  "Commercial safe?",
  "Aggregates sources?",
  "Attribution?",
  "MCP native?",
  "Self-host option?",
  "Browser fallback?",
  "Usage-based pricing?",
];

const ROWS: Array<{ name: string; cells: (string | boolean)[] }> = [
  { name: "webfetch", cells: [true, true, true, true, true, true, true] },
  { name: "Google Images (retired API)", cells: [false, false, false, false, false, false, false] },
  { name: "Unsplash API", cells: [true, false, "partial", false, false, false, false] },
  { name: "Bing Image Search", cells: ["partial", false, false, false, false, false, true] },
  { name: "Serper / SerpAPI", cells: [false, "partial", false, false, false, true, true] },
];

function cell(v: string | boolean) {
  if (v === true) return <span className="text-[var(--accent)] font-medium">yes</span>;
  if (v === false) return <span className="text-[var(--fg-dim)]">no</span>;
  return <span className="text-[var(--fg-dim)]">{v}</span>;
}

export function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-elev)] text-left text-[var(--fg-dim)]">
          <tr>
            <th className="px-4 py-3 font-medium">Tool</th>
            {COLS.map((c) => (
              <th key={c} className="px-4 py-3 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr
              key={r.name}
              className={`border-t border-[var(--border)] ${
                r.name === "webfetch" ? "bg-[rgba(255,122,61,0.04)]" : ""
              }`}
            >
              <td className="px-4 py-3 font-mono">
                {r.name === "webfetch" ? (
                  <span className="text-[var(--accent)] font-semibold">webfetch</span>
                ) : (
                  <span className="text-[var(--fg)]">{r.name}</span>
                )}
              </td>
              {r.cells.map((c, i) => (
                <td key={i} className="px-4 py-3">
                  {cell(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
