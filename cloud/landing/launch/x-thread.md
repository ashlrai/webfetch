# X / Twitter launch thread

## Tweet 1 (hook)

Shipping webfetch today.

One CLI + MCP that replaces "open Google Images, right-click, save, guess at the license" with one tool call.

19 licensed providers. License-first ranker. Attribution on every result. MIT.

[demo gif: CLI returns 5 candidates with license tags]

getwebfetch.com

## Tweet 2 (problem)

Manually sourcing an image has four failure modes:

1. You don't know the license
2. You can't script it
3. Google's Image API is retired
4. No shared cache

webfetch fixes all four at the protocol layer.

## Tweet 3 (install)

30 seconds to try:

```
curl -fsSL https://getwebfetch.com/install.sh | bash
webfetch search "drake portrait" --limit 5
```

Or drop into Claude Code / Cursor / Cline as an MCP. One config line. Every agent gets the same capability.

[screenshot: MCP config snippet]

## Tweet 4 (providers)

19 federated sources at launch:

Wikimedia. Openverse. Unsplash. Pexels. Pixabay. NASA. Smithsonian. Met Museum. LOC. Europeana. Flickr-CC. iTunes. MusicBrainz. Spotify. YouTube. Brave. Bing. SerpAPI. Browser.

License-first ranked. UNKNOWN rejected by default.

## Tweet 5 (license-first)

Why license-first?

Getty v. AI companies. NYT v. OpenAI. Statutory damages still start at $750/image in the US.

The only outcome we refuse is shipping an image we can't justify. Ranker sorts by license > confidence > resolution > provider.

[image: ranking table]

## Tweet 6 (browser moat)

The real moat: "like a human" browser fallback.

When APIs miss, webfetch opt-in fetches from Google Images / Pinterest via a managed browser. Tags the result UNKNOWN. Emits a sidecar JSON with source + consent.

You stay in control of the legal decision.

## Tweet 7 (pricing)

Pricing:

- Free: OSS unlimited locally + 100 cloud fetches/day
- Pro $19/mo: 10K fetches, managed browser, pooled keys
- Team $79/mo + seats: 50K pooled, RBAC, audit log
- Enterprise: SSO + indemnification + on-prem

Self-host the OSS forever. Pay for the parts you can't build.

## Tweet 8 (ship story)

Built this in 2 weeks.

~30 Claude Code agents against a single plan doc. 4 npm packages + Chrome ext + VS Code ext + GitHub Action + Homebrew + Docker + cloud backend + landing site.

117 passing tests. Wrote up the sprint story here: getwebfetch.com/blog/shipping-webfetch

## Tweet 9 (links + CTA)

Try it:
- Site: getwebfetch.com
- Repo: github.com/ashlrai/webfetch
- Blog: getwebfetch.com/blog (3 launch posts)
- HN: [HN link]

If you're building an AI agent that touches images, this saves you a week.

## Tweet 10 (thanks)

Thanks to everyone who tested early. Especially:
- The friend who said "I'd pay for that" in Feb and started this.
- @anthropic for MCP.
- @brightdata for outsourcing our stealth-browser ops so we could ship.

Next: Python SDK, reverse image search, bulk batch mode.
