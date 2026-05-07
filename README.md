# Deneme IPTV

A simple Electron desktop IPTV application. Load an M3U playlist URL or a local `.m3u` file and browse the content across **Live TV**, **Movies**, and **Series** tabs.

## Installation

```bash
npm install
npm run dev
```

## Production-like run

```bash
npm start
```

## Development

```bash
npm run dev
```

The Vite renderer runs on `http://127.0.0.1:5173`, and the Electron window connects to that address. Renderer changes are refreshed instantly with hot reload.

## Validation

```bash
npm run check
```

## Packaging

Local packaging:

```bash
npm run package
```

Platform-specific release packages:

```bash
npm run release:mac
npm run release:mac:signed
npm run release:linux
npm run release:win
```

Generated files are written to `release/`.

Notes:

- The `package`, `release`, and `release:mac` scripts run **unsigned by default** on macOS so local builds do not fail on automatic `codesign` checks.
- For a properly signed macOS package, use `npm run release:mac:signed`.

## Usage

1. Start the application.
2. Paste a playlist URL or open a local `.m3u` file with **Select file**.
3. Pick groups on the left, open items in the middle, and follow playback on the right.
4. In the Series tab, choose the show first, then the season, then the episode.

## Interface

- The renderer is built with **React + Ant Design** components.
- Tab-based navigation: Live TV, Movies, Series
- Global search plus panel-level filtering for groups, channels, movies, series, seasons, and episodes
- XMLTV-based EPG support for Live TV with current and next program details
- Series browser with show -> season -> episode hierarchy
- Recently watched list with one-click resume
- Resume playback for movies and episodes
- Keyboard shortcuts: `/` for search, `Esc` to clear, `Alt + Left/Right` to move between episodes
- Playback uses `mpegts.js` when suitable and the built-in HTML5 video element otherwise

## Notes

- The playlist address is not hard-coded; it is stored locally in browser storage.
- The EPG source can be configured separately as an XMLTV URL or a local XML file from Options > EPG.
- Remote playlist URLs are cached on disk. The same source is downloaded at most once per day, and the last cache is reused if the server temporarily fails.
- Remote EPG sources are also cached on disk and refreshed periodically.
- Classification is based on `group-title`, channel names, and title text.
- The series parser can normalize patterns such as `S01 E01`, `1.Bolum`, and `2.Sezon` into a single show hierarchy.
- Release packages are built with `electron-builder`; targets are `dmg/zip` for macOS, `AppImage/deb/tar.gz` for Linux, and `nsis/portable` for Windows.
- Application icons live under `build/icons/`: `icon.icns` for macOS, `icon.ico` for Windows, and `icon.png` for Linux and general use.

## Open source

- License: [MIT](./LICENSE)
- Contributing guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Security policy: [SECURITY.md](./SECURITY.md)

Please check existing issues before opening a new one, and do not report security problems in public issues.
