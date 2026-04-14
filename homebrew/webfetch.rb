# Homebrew formula for webfetch.
#
# Published to the tap repo github.com/ashlr-ai/homebrew-webfetch.
# The release workflow templates `version`, `url`, and `sha256` on every
# `v*` tag push. Do NOT hand-edit those fields here — edit the template in
# `.github/workflows/release.yml` (homebrew-bump step) instead.
class Webfetch < Formula
  desc "License-first federated image search for AI agents and humans"
  homepage "https://webfetch.dev"
  url "https://registry.npmjs.org/@webfetch/cli/-/cli-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"
  version "0.1.0"

  depends_on "node"

  def install
    # Unpack the npm tarball into libexec and resolve runtime deps with npm.
    libexec.install Dir["*"]
    cd libexec do
      system "npm", "install", "--omit=dev", "--prefix", libexec,
             "@webfetch/core@#{version}",
             "sharp@^0.33.0"
    end

    # Launcher shim on PATH.
    (bin/"webfetch").write <<~SHIM
      #!/usr/bin/env bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/package/dist/index.js" "$@"
    SHIM
    (bin/"webfetch").chmod 0755
  end

  test do
    assert_match "webfetch", shell_output("#{bin}/webfetch --help")
  end
end
