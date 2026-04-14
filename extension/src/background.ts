/**
 * Service worker:
 *   - Registers the "Save with webfetch (with attribution)" context menu on images
 *   - On click: /probe the page → /license the image → chrome.downloads + sidecar JSON
 *   - Toggle sidebar on Cmd/Ctrl+Shift+F via command API (forwards to content script)
 *   - Accepts `{type: "setToken", token}` from /auth/display relay pages (not used
 *     by the basic flow — token is manually pasted in options)
 */

import { call, loadSettings } from "./shared/api.js";

const MENU_ID = "webfetch-save-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save with webfetch (with attribution)",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  await saveImage(info.srcUrl, info.pageUrl ?? tab?.url ?? "");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-sidebar") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "webfetch:toggle-sidebar" });
  } catch {
    // content script not loaded (e.g. chrome:// page) — silently no-op
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg?.type === "webfetch:save-image") {
      const r = await saveImage(msg.url, msg.pageUrl ?? "");
      send(r);
    } else if (msg?.type === "webfetch:search") {
      const r = await call("/search", msg.body);
      send(r);
    } else if (msg?.type === "webfetch:download") {
      const r = await call("/download", { url: msg.url });
      send(r);
    } else if (msg?.type === "webfetch:ping") {
      const r = await call("/health", undefined, "GET");
      send(r);
    }
  })();
  return true;
});

async function saveImage(imageUrl: string, pageUrl: string) {
  try {
    const licenseRes = await call<{ license?: string; attributionLine?: string; sourcePageUrl?: string; author?: string }>(
      "/license",
      { url: imageUrl, probe: false },
    );

    let probeData: any = null;
    if (pageUrl) {
      const probe = await call<any>("/probe", { url: pageUrl, respectRobots: true });
      if (probe.ok) probeData = probe.data;
    }

    const id = await chrome.downloads.download({ url: imageUrl, saveAs: false });

    const sidecar = {
      savedAt: new Date().toISOString(),
      imageUrl,
      pageUrl,
      license: licenseRes.data?.license ?? "UNKNOWN",
      attributionLine: licenseRes.data?.attributionLine ?? "",
      author: licenseRes.data?.author ?? "",
      sourcePageUrl: licenseRes.data?.sourcePageUrl ?? pageUrl,
      probe: probeData,
    };

    const blob = new Blob([JSON.stringify(sidecar, null, 2)], { type: "application/json" });
    const sidecarUrl = URL.createObjectURL(blob);
    const fileName = sidecarFilename(imageUrl);
    await chrome.downloads.download({ url: sidecarUrl, filename: fileName, saveAs: false });

    const settings = await loadSettings();
    const recents = ((await chrome.storage.local.get("recents")).recents as any[]) ?? [];
    recents.unshift({ imageUrl, license: sidecar.license, savedAt: sidecar.savedAt });
    await chrome.storage.local.set({ recents: recents.slice(0, 25) });

    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "webfetch saved image",
      message: `License: ${sidecar.license}\n${sidecar.attributionLine || "(no attribution)"} \nvia ${settings.serverUrl}`,
    });

    return { ok: true, data: { downloadId: id, sidecar } };
  } catch (e: any) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "webfetch save failed",
      message: String(e?.message ?? e),
    });
    return { ok: false, error: String(e?.message ?? e) };
  }
}

function sidecarFilename(url: string): string {
  const last = url.split("?")[0]!.split("/").pop() || "image";
  const base = last.replace(/\.[a-z0-9]{1,5}$/i, "") || "image";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `webfetch/${base}.${stamp}.sidecar.json`;
}
