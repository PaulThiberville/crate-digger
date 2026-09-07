# FREEBASS · `crate`

Terminal tool that archives **only official SoundCloud free downloads**: paste a curator's profile URL, it scans every account they follow, lists their tracks and keeps those with downloads enabled (`downloadable` + `has_downloads_left`, public, ≤ 12 min). No stream rips, no re-encoding.

## Use

1. Grab `crate` (macOS) or `crate.exe` (Windows) from the Releases page — no Node needed. macOS: `chmod +x crate && xattr -d com.apple.quarantine crate`.
2. Run `crate`. It opens Chrome/Edge/Brave on SoundCloud's login page (no password in the terminal). Keep that window open: it is your SoundCloud session for the run. The session is stored user-only in `~/.config/crate/`, never in the repo. `crate logout` forgets it.
3. Paste `https://soundcloud.com/<curator>`, read the recap (HIGH = lossless originals, LOW = lossy), pick what to download.

Files land in `~/Documents/Music/Crate Digger/<curator>/<uploader>/`. The global `index.json` there prevents re-downloads across curators (id + file still present). `--max-minutes 20` changes the length filter. Exit code is non-zero when a download failed.

## Dev

Node ≥ 22: `npm install`, then `npm start` (same flow as the binary), `npm test`, `npm run typecheck`. `npm run mock` starts an offline fake SoundCloud to try the whole flow without touching the real API (see the header of `scripts/mock-soundcloud.mjs`). `CRATE_DEBUG=1` writes a request log to `~/.config/crate/debug.log`.

## Binaries

Needs [Bun](https://bun.sh) ≥ 1.2: `npm run build` → `dist/windows-x64/crate.exe`, `dist/macos-arm64/crate`, `dist/macos-x64/crate` (cross-compiled from any OS). Pushing a `v*` tag builds and attaches them to a GitHub Release (`.github/workflows/release.yml`).
