/**
 * Options page: persists serverUrl + token + default policy + provider prefs
 * in chrome.storage.local. Also offers a "test connection" button that pings
 * /health through the service worker.
 */

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../shared/api.js";

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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const s = await loadSettings();
  ($("serverUrl") as HTMLInputElement).value = s.serverUrl || DEFAULT_SETTINGS.serverUrl;
  ($("token") as HTMLInputElement).value = s.token;
  ($("policy") as HTMLSelectElement).value = s.defaultPolicy;

  const wrap = $("providers");
  const selected = new Set(s.defaultProviders);
  for (const p of PROVIDERS) {
    const c = document.createElement("span");
    c.className = `chip${selected.has(p) ? " on" : ""}`;
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
    wrap.appendChild(c);
  }

  $("save").addEventListener("click", async () => {
    await saveSettings({
      serverUrl: ($("serverUrl") as HTMLInputElement).value.trim(),
      token: ($("token") as HTMLInputElement).value.trim(),
      defaultPolicy: ($("policy") as HTMLSelectElement).value as any,
      defaultProviders: [...selected],
    });
    setStatus("saved.");
  });

  $("test").addEventListener("click", async () => {
    setStatus("testing...");
    const r = await chrome.runtime.sendMessage({ type: "webfetch:ping" });
    if (r?.ok) setStatus("connection ok.");
    else setStatus(`failed: ${r?.error ?? "unknown"}`, true);
  });
}

function setStatus(msg: string, err = false) {
  const s = $("status");
  s.textContent = msg;
  s.classList.toggle("err", err);
}

init();
