/**
 * Content script — injects a shadow-DOM sidebar on Cmd/Ctrl+Shift+F.
 *
 * Why shadow DOM: host-page CSS cannot bleed into our UI, and most hostile
 * host stylesheets can't override shadow-root scoped styles. Known limitation:
 * pages with strict CSP that block eval still work (we don't eval), but pages
 * with aggressive `frame-ancestors` or `trusted-types` policies may prevent
 * content-script injection entirely — in those cases, use the popup instead.
 */

const ROOT_ID = "webfetch-sidebar-root";

interface Candidate {
  url: string;
  license?: string;
  author?: string;
  width?: number;
  height?: number;
  provider?: string;
  attributionLine?: string;
  sourcePageUrl?: string;
}

function ensureRoot(): ShadowRoot {
  let host = document.getElementById(ROOT_ID) as HTMLElement | null;
  if (host?.shadowRoot) return host.shadowRoot;
  host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0 0 0 auto";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .panel {
        pointer-events: auto;
        position: fixed; top: 0; right: 0; bottom: 0;
        width: 420px; max-width: 90vw;
        background: #0b0d10; color: #eceff3;
        font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
        border-left: 1px solid #1f252d;
        display: none; flex-direction: column;
        box-shadow: -12px 0 32px rgba(0,0,0,.35);
      }
      .panel.open { display: flex; }
      header { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid #1f252d; }
      header .title { font-weight: 600; flex: 1; }
      header button { background: transparent; border: 1px solid #2a323c; color: #cbd2d9;
                      border-radius: 6px; padding: 4px 8px; cursor: pointer; }
      .search { display: flex; gap: 6px; padding: 12px; }
      .search input { flex: 1; background: #14181d; border: 1px solid #1f252d; color: #eceff3;
                      border-radius: 6px; padding: 8px; }
      .search button { background: #3b82f6; border: 0; color: white; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
      .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 12px; }
      .chip { background: #14181d; border: 1px solid #1f252d; color: #cbd2d9;
              padding: 3px 8px; border-radius: 999px; font-size: 11px; cursor: pointer; user-select: none; }
      .chip.on { background: #1d4ed8; color: white; border-color: #1d4ed8; }
      select { background: #14181d; border: 1px solid #1f252d; color: #eceff3; padding: 3px 8px; border-radius: 6px; font-size: 11px; }
      .status { padding: 0 12px 8px; font-size: 11px; color: #9aa3af; min-height: 14px; }
      .grid { flex: 1; overflow: auto; padding: 12px; display: grid;
              grid-template-columns: repeat(2, 1fr); gap: 8px; align-content: start; }
      .card { background: #14181d; border: 1px solid #1f252d; border-radius: 8px; overflow: hidden;
              cursor: pointer; display: flex; flex-direction: column; }
      .card:hover { border-color: #3b82f6; }
      .card img { width: 100%; height: 120px; object-fit: cover; background: #0b0d10; }
      .card .meta { padding: 6px 8px; font-size: 10px; color: #9aa3af; display: flex; justify-content: space-between; gap: 4px; }
      .meta .lic { color: #34d399; font-weight: 600; text-transform: lowercase; }
      footer { padding: 8px 12px; border-top: 1px solid #1f252d; font-size: 11px; color: #6b7280; }
    </style>
    <div class="panel" part="panel">
      <header>
        <div class="title">webfetch</div>
        <button id="close">close</button>
      </header>
      <div class="search">
        <input id="q" placeholder="search query (e.g. Drake portrait)" />
        <button id="go">search</button>
      </div>
      <div class="filters" id="chips"></div>
      <div class="filters">
        <label style="font-size:11px;color:#9aa3af;display:flex;align-items:center;gap:6px">
          license
          <select id="policy">
            <option value="safe-only">safe-only</option>
            <option value="prefer-safe">prefer-safe</option>
            <option value="any">any</option>
          </select>
        </label>
      </div>
      <div class="status" id="status"></div>
      <div class="grid" id="grid"></div>
      <footer>Click a result to download. Shadow-DOM UI — some hardened sites may still block.</footer>
    </div>
  `;
  wire(root);
  return root;
}

const PROVIDERS = [
  "wikimedia",
  "openverse",
  "unsplash",
  "pexels",
  "pixabay",
  "itunes",
  "musicbrainz-caa",
  "spotify",
  "brave",
];
const selected = new Set<string>();

function wire(root: ShadowRoot) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const chips = $("#chips") as HTMLElement;
  for (const p of PROVIDERS) {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = p;
    c.addEventListener("click", () => {
      if (selected.has(p)) {
        selected.delete(p);
        c.classList.remove("on");
      } else {
        selected.add(p);
        c.classList.add("on");
      }
    });
    chips.appendChild(c);
  }
  $("#close").addEventListener("click", () => toggle(false));
  ($("#q") as HTMLInputElement).addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") doSearch(root);
  });
  $("#go").addEventListener("click", () => doSearch(root));
}

async function doSearch(root: ShadowRoot) {
  const q = (root.querySelector("#q") as HTMLInputElement).value.trim();
  const policy = (root.querySelector("#policy") as HTMLSelectElement).value;
  const status = root.querySelector("#status") as HTMLElement;
  const grid = root.querySelector("#grid") as HTMLElement;
  if (!q) {
    status.textContent = "type a query";
    return;
  }
  status.textContent = "searching...";
  grid.innerHTML = "";
  const body: any = { query: q, licensePolicy: policy };
  if (selected.size) body.providers = [...selected];
  const res = await chrome.runtime.sendMessage({ type: "webfetch:search", body });
  if (!res?.ok) {
    status.textContent = `error: ${res?.error ?? "unknown"}`;
    return;
  }
  const cands: Candidate[] = res.data?.candidates ?? [];
  status.textContent = `${cands.length} results`;
  for (const c of cands) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img loading="lazy" src="${escapeAttr(c.url)}" alt="" />
      <div class="meta">
        <span>${escapeText(c.provider ?? "")}</span>
        <span class="lic">${escapeText((c.license ?? "UNKNOWN").toLowerCase())}</span>
      </div>
    `;
    card.addEventListener("click", async () => {
      card.style.opacity = "0.5";
      const r = await chrome.runtime.sendMessage({
        type: "webfetch:save-image",
        url: c.url,
        pageUrl: c.sourcePageUrl ?? "",
      });
      card.style.opacity = r?.ok ? "1" : "0.3";
    });
    grid.appendChild(card);
  }
}

function toggle(force?: boolean) {
  const root = ensureRoot();
  const panel = root.querySelector(".panel") as HTMLElement;
  const shouldOpen = force ?? !panel.classList.contains("open");
  panel.classList.toggle("open", shouldOpen);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "webfetch:toggle-sidebar") toggle();
});

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
