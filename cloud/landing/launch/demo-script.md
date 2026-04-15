# Demo script — 4 minutes

Total runtime target: 3:45-4:15. Voice: flat, confident, no hype. Mason records solo. Screen-first, face optional in bottom-right.

---

## [0:00 - 0:15] Cold open

**Screen:** Claude Code window, user types "add a drake portrait to this page".

**Voice:** "This is what happens today when an AI agent needs an image." [agent right-click-saves a random JPG, invents a license string, pastes it into markdown]

**Voice:** "That image is copyrighted. The license is fabricated. The pipeline doesn't know."

[smash cut to webfetch logo]

**Voice:** "webfetch fixes this."

## [0:15 - 0:45] The 30-second install

**Screen:** clean terminal.

**Voice:** "Thirty seconds to install."

```
curl -fsSL https://getwebfetch.com/install.sh | bash
```

**Screen:** installer prints, finishes, `webfetch version` shows `1.0.0`.

**Voice:** "One line. Bun if needed. CLI on your path. MCP registered in Claude Code. Done."

## [0:45 - 1:30] CLI demo

**Screen:** terminal.

```
webfetch search "drake portrait" --limit 5
```

**Screen:** table prints — 5 candidates with license tags, confidence scores, widths.

**Voice:** "Five candidates. Ranked license-first. CC-BY-SA at the top, confidence point-nine-five. UNKNOWN filtered out by default. Every result comes with attribution pre-built."

**Screen:**

```
webfetch download <top url> --out ./portrait.jpg
cat ./portrait.jpg.sidecar.json
```

**Voice:** "Download writes the image and a sidecar with the attribution line and the source URL. Ship that. You're done."

## [1:30 - 2:15] MCP in Claude Code

**Screen:** Claude Code. User types: "build me a landing page with three license-safe portraits of jazz musicians from the 1960s."

**Voice:** "Same capability, different surface. In any MCP agent — Claude Code, Cursor, Cline — webfetch is a tool call."

**Screen:** Claude Code calls `search_images` three times, picks results, writes markdown with images and attribution lines inline.

**Voice:** "Three searches. Nine candidates. Three shipped. Attribution in the markdown. The agent never guessed a license because it never had to."

## [2:15 - 2:50] Chrome extension

**Screen:** a product page, Chrome extension sidebar opens.

**Voice:** "Not an agent? The Chrome extension puts the same search next to any page you're reading."

**Screen:** type "drake portrait" → sidebar fills with candidates → drag one into a text editor.

**Voice:** "Drag to drop, license tag travels with it. Works everywhere there's a contentEditable."

## [2:50 - 3:30] Dashboard + pricing

**Screen:** app.getwebfetch.com — usage graph, API keys page, audit log.

**Voice:** "The OSS is unlimited on your machine. If you want a managed browser fallback for the pages APIs don't cover, pooled keys so you don't manage credentials, or an audit log your legal team can export, that's the cloud tier. Nineteen a month for Pro. Seventy-nine for a team."

**Screen:** quick zoom on usage chart showing cached-vs-billed rows.

**Voice:** "Cached hits are free. Failed calls are free. You only pay for actual fetches."

## [3:30 - 4:00] Close

**Screen:** getwebfetch.com homepage.

**Voice:** "webfetch dot dev. Thirty seconds to install. Free to use. Open source. Every image you ship ships with attribution. No guessing."

**Screen:** fade to GitHub + npm badges.

**Voice:** "That's the whole thing."

---

## Shot checklist

- [ ] Cold open with bad-agent behavior (use a stub script to fake the wrong behavior if needed — don't ship a real hallucination as if organic)
- [ ] Install on a clean VM (OrbStack ubuntu) — no existing state
- [ ] CLI demo on mac terminal with Geist Mono, dark theme
- [ ] Claude Code with the webfetch MCP already registered
- [ ] Chrome with the extension installed on a clean profile
- [ ] Dashboard recording with fake but realistic data (1 week of usage)

## B-roll

- Logo reveal (Lottie, 1.5s)
- Provider logos carousel (under 1 second flash each) — Wikimedia, Unsplash, NASA, Smithsonian, Met, LOC
- Architecture diagram zoom (from /#how-it-works SVG)

## Audio

- No music under voice. Soft pad in the last 10 seconds only.
- Voice recorded on the Shure SM7B, pop filter, -18 dBFS average.
- Silence any mouse clicks in post.

## Text overlays

- Bottom-left persistent: "getwebfetch.com · MIT · MCP-native"
- Callouts on license tags (yellow outline, 1.5s) when each appears

## Captions
Auto-generated, hand-corrected, burned in as SRT + baked for silent autoplay on Twitter.
