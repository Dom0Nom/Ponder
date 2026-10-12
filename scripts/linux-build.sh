#!/usr/bin/env bash
# Builds the Linux .deb and AppImage in Docker. Output: dist-linux/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist-linux
docker run --rm --platform linux/amd64 \
  -v "$PWD":/src:ro \
  -v "$PWD/dist-linux":/out \
  -v ponder-linux-cargo:/usr/local/cargo/registry \
  -v ponder-linux-target:/work/src-tauri/target \
  -e APPIMAGE_EXTRACT_AND_RUN=1 \
  rust:1-bookworm bash -euo pipefail -c '
    apt-get update -qq
    apt-get install -y -qq libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libxdo-dev libdbus-1-dev patchelf file unzip curl >/dev/null
    curl -fsSL https://bun.sh/install | bash >/dev/null
    export PATH=/root/.bun/bin:$PATH
    mkdir -p /work
    tar -C /src --exclude=./node_modules --exclude=./src-tauri/target --exclude=./.claude --exclude=./dist-linux --exclude=./.git -cf - . | tar -C /work -xf -
    cd /work
    bun install --frozen-lockfile
    bun run tauri build --bundles deb,appimage
    cp src-tauri/target/release/bundle/deb/*.deb src-tauri/target/release/bundle/appimage/*.AppImage /out/
  '
ls -la dist-linux
