# Change Log

All notable changes to the "oniro-ide" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.6.0]

### Changed
- Updated `@oniroproject/core` to 0.10.0.
  - Windows: process launching now goes through a `cmd` wrapper with proper argument escaping, child process trees are terminated correctly, long paths are handled, and `hvigorw` resolves to `hvigorw.bat`. The extension delegates all process execution to core, so it inherits these. Not yet validated end-to-end on Windows.
  - Log and device output is now split on CRLF as well as LF, fixing garbled entries in the hilog viewer and in device listing on Windows.

## [0.5.0]

### Added
- `oniro.tmpDir` setting: directory used for temporary files while downloading and extracting the SDK, command-line tools, and emulator. Leave empty to use a `.oniro-tmp` folder next to the install target.

### Changed
- Updated `@oniroproject/core` to 0.8.0. Installs now unpack next to their install target rather than in the system temp dir, which fixes SDK and command-line-tools installs failing on Linux systems where `/tmp` is a RAM-backed `tmpfs` smaller than the archive. Running out of space is now reported with the directory, the space needed, and how to change it, instead of failing with an unhandled error.

## [0.4.2]

### Changed
- Extension renamed from `oniro-ide` to `oniro-app-ide` and display name changed from "Oniro IDE" to "Oniro App IDE" to avoid name/display-name conflicts with the previously-published `francescopham.oniro-ide` listing. The new install identifier is `oniro.oniro-app-ide` on both registries.

## [0.4.1] — broken release, do not use

Renamed the extension to `oniro-app-ide` but the VS Code Marketplace also rejected the display name "Oniro IDE" (already taken by the prior publisher). 0.4.2 supersedes it with display name "Oniro App IDE".

## [0.4.0] — broken release, do not use

The 0.4.0 release failed mid-publish: it landed on Open VSX as `oniro.oniro-ide@0.4.0` but was rejected by the VS Code Marketplace because the name `oniro-ide` is already owned by another publisher. 0.4.2 supersedes it under the new name `oniro-app-ide` with display name "Oniro App IDE".

### Added
- ArkTS language support: grammar, language configuration, language client, and `code-linter.json5` schema validation.
- GitHub Actions release workflow (`.github/workflows/release.yml`) that publishes to the VS Code Marketplace and Open VSX on `v*` tag pushes, and attaches the `.vsix` to a GitHub Release.
- `package`, `publish:vscode`, and `publish:openvsx` npm scripts; `@vscode/vsce` and `ovsx` added as devDependencies.

### Changed
- Refactored SDK, build, emulator, hdc, hilog, and project scaffolding logic out of the extension and into `@oniroproject/core`.
- Marketplace publisher switched from `francescopham` to `oniro`; install URLs updated in the README.
- `.vscodeignore` now excludes `.github/**` and local `*.vsix` files from packaging.

## [0.3.2]

- Version bump.