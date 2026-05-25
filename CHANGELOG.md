# Change Log

All notable changes to the "oniro-ide" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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