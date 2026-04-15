# Smithery submission — @webfetch/mcp

Target registry: https://smithery.ai

Smithery indexes npm-published MCP servers and adds one-click install +
hosted deployment. Submission is a `smithery.yaml` at the repo root plus
registry metadata.

## `smithery.yaml` (place at `packages/mcp/smithery.yaml`)

```yaml
startCommand:
  type: stdio
  configSchema:
    type: object
    required: []
    properties:
      WEBFETCH_API_KEY:
        type: string
        description: Optional webfetch cloud API key (Pro/Team pooled keys + managed browser).
      UNSPLASH_ACCESS_KEY:
        type: string
      PEXELS_API_KEY:
        type: string
      PIXABAY_API_KEY:
        type: string
      FLICKR_API_KEY:
        type: string
      BRAVE_SEARCH_API_KEY:
        type: string
      SERPAPI_KEY:
        type: string
      SPOTIFY_CLIENT_ID:
        type: string
      SPOTIFY_CLIENT_SECRET:
        type: string
  commandFunction:
    |-
    (config) => ({
      command: 'npx',
      args: ['-y', '@webfetch/mcp'],
      env: { ...config }
    })
```

## Registry metadata (Smithery dashboard)

- **Display name:** webfetch
- **Short description (140 char):** License-first image search for AI
  agents. 24 licensed providers, one MCP, UNKNOWN rejected by default,
  attribution on every result.
- **Long description:** paste the devto-post.md intro + "The design"
  section.
- **Category:** `Search & Data`
- **Tags:** `images`, `creative-commons`, `search`, `license`,
  `attribution`, `federated`
- **Repository:** `ashlrai/webfetch`
- **License:** MIT
- **Homepage:** https://getwebfetch.com
- **Docs:** https://getwebfetch.com/docs
- **Deployment preference:** user-hosted (stdio). We'll add hosted
  (HTTP) after the cloud dashboard opens public signup.

## Submission checklist

- [ ] `smithery.yaml` committed at `packages/mcp/smithery.yaml`
- [ ] `@webfetch/mcp@0.1.0` live on npm
- [ ] README has MCP-specific "Tools" section
- [ ] Smithery CLI `npx @smithery/cli list` finds the package
- [ ] Submit via https://smithery.ai/new

## Post-merge

- Copy the Smithery install command into the README's "Quick start (MCP)"
  section.
- Add the `npx @smithery/cli install @webfetch/mcp` line to the landing
  install tabs.
