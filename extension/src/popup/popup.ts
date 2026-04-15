/**
 * Popup: status indicator, quick search box, recent saves list.
 *
 * Keeps its own chrome.storage.local-backed recents view (fed by background.ts
 * on every successful save).
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const status = $<HTMLElement>("status");
  const res = await chrome.runtime.sendMessage({ type: "webfetch:ping" });
  if (res?.ok) {
    status.textContent = "server ok";
    status.classList.add("ok");
  } else {
    status.textContent = res?.error ? "offline" : "no token";
    status.classList.add("err");
  }

  $<HTMLButtonElement>("go").addEventListener("click", runSearch);
  $<HTMLInputElement>("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  $<HTMLAnchorElement>("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await renderRecents();
}

async function runSearch() {
  const q = $<HTMLInputElement>("q").value.trim();
  if (!q) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "webfetch:toggle-sidebar" });
    } catch {}
  }
  // Persist last query so sidebar can pick it up if desired later.
  await chrome.storage.local.set({ lastQuery: q });
  window.close();
}

async function renderRecents() {
  const { recents } = await chrome.storage.local.get("recents");
  const ul = $<HTMLElement>("recents");
  ul.innerHTML = "";
  const items = (recents as any[] | undefined) ?? [];
  if (!items.length) {
    ul.innerHTML = `<li style="color:#6b7280">none yet</li>`;
    return;
  }
  for (const r of items.slice(0, 8)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="lic">${escape(r.license ?? "UNKNOWN").toLowerCase()}</span>
                    <a href="${escape(r.imageUrl)}" target="_blank">${escape(shortUrl(r.imageUrl))}</a>`;
    ul.appendChild(li);
  }
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return x.hostname + x.pathname.slice(0, 30);
  } catch {
    return u.slice(0, 40);
  }
}
function escape(s: string): string {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

init();
