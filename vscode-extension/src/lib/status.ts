/**
 * Status-bar indicator. Reflects connection state to the webfetch API.
 *
 * Left-aligned, low priority, clickable → opens settings. Polled lazily on
 * activation and after settings changes; the panel also pushes updates via
 * `refresh()` when searches succeed/fail.
 */

import * as vscode from "vscode";
import { ping } from "./client";

export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "workbench.action.openSettings";
    this.item.name = "webfetch";
    this.setUnknown();
    this.item.show();
    context.subscriptions.push(this.item);
  }

  setReady(): void {
    this.item.text = "$(check) webfetch";
    this.item.tooltip = "webfetch ready";
    this.item.backgroundColor = undefined;
  }

  setNeedsKey(): void {
    this.item.text = "$(warning) webfetch";
    this.item.tooltip = "webfetch: no API key — click to configure";
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    this.item.command = "webfetch.setApiKey";
  }

  setOffline(reason: string): void {
    this.item.text = "$(error) webfetch";
    this.item.tooltip = `webfetch offline: ${reason}`;
    this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    this.item.command = "workbench.action.openSettings";
  }

  setUnknown(): void {
    this.item.text = "$(sync~spin) webfetch";
    this.item.tooltip = "webfetch: checking...";
    this.item.backgroundColor = undefined;
  }

  async refresh(): Promise<void> {
    this.setUnknown();
    const r = await ping(this.context);
    if (r.ok) {
      this.setReady();
      this.item.command = "webfetch.search";
    } else if (r.status === 0 && r.error?.includes("no API key")) {
      this.setNeedsKey();
    } else if (r.status === 401 || r.status === 403) {
      this.setNeedsKey();
    } else {
      this.setOffline(r.error ?? "unknown");
    }
  }
}
