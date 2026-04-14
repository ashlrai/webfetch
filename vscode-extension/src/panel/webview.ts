/**
 * Webview runtime. Plain TS + DOM — no frameworks.
 *
 * Talks to the extension host via `acquireVsCodeApi()`. All network traffic
 * goes through the host (so the API key stays out of the CSP-restricted iframe).
 */

import type {
  ImageCandidate,
  InitialConfig,
  LicensePolicy,
  ProviderId,
  SearchResponse,
  WebviewInbound,
  WebviewOutbound,
} from "../types";

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewOutbound): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
};

const vscode = acquireVsCodeApi();

interface State {
  query: string;
  policy: LicensePolicy;
  activeProviders: Set<ProviderId>;
  allProviders: string[];
  defaultProviders: ProviderId[];
  hasApiKey: boolean;
  lastResult?: SearchResponse;
}

const state: State = {
  query: "",
  policy: "safe-only",
  activeProviders: new Set(),
  allProviders: [],
  defaultProviders: [],
  hasApiKey: false,
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

function licenseColor(license: ImageCandidate["license"]): string {
  switch (license) {
    case "CC0": case "PUBLIC_DOMAIN": return "#16a34a";
    case "CC_BY": case "CC_BY_SA": return "#2563eb";
    case "PRESS_KIT_ALLOWLIST": return "#7c3aed";
    case "EDITORIAL_LICENSED": return "#d97706";
    default: return "#6b7280";
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function applyHello(config: InitialConfig): void {
  state.allProviders = config.allProviders;
  state.defaultProviders = config.defaultProviders;
  state.policy = config.defaultLicense;
  state.hasApiKey = config.hasApiKey;
  (document.getElementById("policy") as HTMLSelectElement).value = config.defaultLicense;
  renderChips();
  renderStatus(
    config.hasApiKey
      ? `Connected to ${config.baseUrl}`
      : "No API key — click 'Set API key' below to configure.",
    config.hasApiKey ? "ok" : "warn",
  );
}

function renderStatus(text: string, kind: "ok" | "warn" | "err" | "" = ""): void {
  const el = document.getElementById("statusLine");
  if (!el) return;
  el.textContent = text;
  el.className = `wf-status ${kind}`;
}

function renderChips(): void {
  const container = $("providerChips");
  container.innerHTML = "";
  if (!state.allProviders.length) return;
  for (const p of state.allProviders) {
    const chip = document.createElement("span");
    chip.className = "wf-chip";
    chip.textContent = p;
    const isActive =
      state.activeProviders.size === 0
        ? state.defaultProviders.length === 0 || state.defaultProviders.includes(p as ProviderId)
        : state.activeProviders.has(p as ProviderId);
    if (isActive) chip.classList.add("active");
    chip.addEventListener("click", () => {
      const id = p as ProviderId;
      if (state.activeProviders.has(id)) state.activeProviders.delete(id);
      else state.activeProviders.add(id);
      renderChips();
    });
    container.appendChild(chip);
  }
}

function onSearch(): void {
  const q = (document.getElementById("q") as HTMLInputElement).value.trim();
  if (!q) return;
  state.query = q;
  state.policy = (document.getElementById("policy") as HTMLSelectElement).value as LicensePolicy;
  $("empty").setAttribute("hidden", "");
  renderStatus("Searching...", "");
  $("grid").innerHTML = "";
  $("reports").innerHTML = "";
  $("warnings").setAttribute("hidden", "");
  vscode.postMessage({
    type: "search",
    query: q,
    policy: state.policy,
    providers: Array.from(state.activeProviders),
  });
}

function renderResults(result: SearchResponse): void {
  state.lastResult = result;
  const grid = $("grid");
  grid.innerHTML = "";
  if (!result.candidates.length) {
    renderStatus("No results. Try a different query or broaden the license filter.", "warn");
    return;
  }
  renderStatus(`${result.candidates.length} result(s)`, "ok");

  for (const c of result.candidates) {
    const card = document.createElement("div");
    card.className = "wf-card";
    card.setAttribute("role", "listitem");
    card.draggable = true;
    const thumb = c.thumbnailUrl ?? c.url;
    card.innerHTML = `
      <span class="wf-badge" style="background:${licenseColor(c.license)}">${escapeHtml(c.license)}</span>
      ${c.viaBrowserFallback ? `<span class="wf-browser-badge">browser</span>` : ""}
      <img class="wf-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(c.title ?? "")}" loading="lazy" />
      <div class="wf-meta">
        <span class="title">${escapeHtml(c.title ?? "untitled")}</span>
        <span class="sub">${escapeHtml(c.author ?? c.source)} · ${c.width ?? "?"}×${c.height ?? "?"}</span>
      </div>`;
    card.addEventListener("click", () => {
      vscode.postMessage({ type: "insert", candidate: c, alt: c.title });
    });
    card.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      vscode.postMessage({ type: "openExternal", url: c.sourcePageUrl ?? c.url });
    });
    card.addEventListener("dragstart", (ev) => {
      const text = `![${c.title ?? "image"}](${c.url})`;
      ev.dataTransfer?.setData("text/plain", text);
      ev.dataTransfer?.setData("text/uri-list", c.url);
      ev.dataTransfer?.setData("application/vnd.code.tree.webfetch", JSON.stringify(c));
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
      vscode.postMessage({ type: "dragStart", candidate: c });
    });
    grid.appendChild(card);
  }

  const reports = $("reports");
  reports.innerHTML = result.providerReports
    .map(
      (r) => `<div class="row ${r.ok ? "ok" : "err"}">
        <span>${escapeHtml(r.provider)}</span>
        <span>·</span>
        <span>${r.ok ? `${r.count} results · ${r.timeMs}ms` : (r.skipped ?? r.error ?? "error")}</span>
      </div>`,
    )
    .join("");

  if (result.warnings.length) {
    const w = $("warnings");
    w.textContent = result.warnings.join(" · ");
    w.removeAttribute("hidden");
  }
}

window.addEventListener("message", (ev: MessageEvent<WebviewInbound>) => {
  const msg = ev.data;
  if (!msg) return;
  switch (msg.type) {
    case "hello":
      applyHello(msg.config);
      return;
    case "searchResult":
      renderResults(msg.result);
      return;
    case "searchError":
      renderStatus(`Error: ${msg.error}`, "err");
      return;
    case "providers":
      state.allProviders = msg.providers.all;
      renderChips();
      return;
    case "inserted":
      renderStatus(`Saved ${msg.relativePath} (${msg.license})`, "ok");
      return;
    case "focusSearch": {
      const q = document.getElementById("q") as HTMLInputElement;
      q.focus();
      if (msg.query) {
        q.value = msg.query;
        onSearch();
      }
      return;
    }
    case "status":
      renderStatus(msg.message ?? "", msg.connected ? "ok" : "warn");
      return;
  }
});

function init(): void {
  $("go").addEventListener("click", onSearch);
  const q = document.getElementById("q") as HTMLInputElement;
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSearch();
  });
  document.getElementById("policy")!.addEventListener("change", (e) => {
    state.policy = (e.target as HTMLSelectElement).value as LicensePolicy;
  });
  document.getElementById("providersBtn")!.addEventListener("click", () => {
    vscode.postMessage({ type: "refreshProviders" });
  });
  document.getElementById("openDashboard")!.addEventListener("click", (e) => {
    e.preventDefault();
    vscode.postMessage({ type: "openDashboard" });
  });
  document.getElementById("setApiKey")!.addEventListener("click", (e) => {
    e.preventDefault();
    vscode.postMessage({ type: "setApiKey" });
  });
  vscode.postMessage({ type: "ready" });
}

init();
