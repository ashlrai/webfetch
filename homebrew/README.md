# webfetch — Homebrew tap

This directory hosts the canonical `webfetch.rb` formula. The formula itself
lives in a separate tap repository so users can `brew tap` + `brew install` it:

```
github.com/ashlr-ai/homebrew-webfetch
└── Formula/
    └── webfetch.rb
```

## Install for users

```bash
brew tap ashlr-ai/webfetch
brew install webfetch
```

## How the tap is updated

On every `v*` tag push:

1. `.github/workflows/release.yml` publishes `@webfetch/cli` to npm.
2. A follow-up step (or a manual `brew bump-formula-pr`) templates the new
   `version`, `url`, and `sha256` into `webfetch.rb` and opens a PR against
   the tap repo.

Until the bump step is wired in, update the tap manually:

```bash
# Compute the sha256 of the just-published tarball.
curl -sL "https://registry.npmjs.org/@webfetch/cli/-/cli-${VERSION}.tgz" \
  | shasum -a 256

# Edit the tap repo, commit, push.
```

## One-time tap bootstrap

Create the tap repo (empty GitHub repo named `homebrew-webfetch`), then:

```bash
git clone git@github.com:ashlr-ai/homebrew-webfetch.git
cd homebrew-webfetch
mkdir -p Formula
cp /path/to/web-fetcher-mcp/homebrew/webfetch.rb Formula/webfetch.rb
git add Formula/webfetch.rb
git commit -m "Initial webfetch formula"
git push
```

After the first `npm publish`, run `brew audit --new-formula webfetch` locally
to validate the formula before users install it.
