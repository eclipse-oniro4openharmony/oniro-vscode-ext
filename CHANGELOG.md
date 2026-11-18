# Change Log

All notable changes to the "oniro-ide" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.7.0]

### Added
- Build errors and warnings in the Problems panel (ArkTS, hvigor, native, ohpm), from core's `buildWithDiagnostics`. A build of a project whose SDK is missing offers to install it; a project without signing configs is offered signing first. Builds are cancellable.
- **Check ArkTS** and **Fix ArkTS Problems**: the SDK's ArkTS checker and the ArkUI rules, without a build, into the Problems panel. `oniro.checkArktsOnSave` checks each saved `.ets` file.
- **Target device** selection (status bar, sidebar, **Select Target Device**), applied to every device command and exported to integrated terminals as `ONIRO_DEVICE_SERIAL`.
- **Stop App**, **Uninstall App**, **Take Device Screenshot** and **Show Last Crash** (faultlog analysis with a link to the project line involved).
- Test Explorer integration for `ohosTest` suites, run on the device through core's `runTests`.
- **Run Doctor**: toolchain health check with fixes, also shown in the sidebar.
- HarmonyOS: **Sign Project** signs HarmonyOS products with AppGallery Connect debug material; **Sign In/Out of Huawei Developer Account**.
- **Sign HAP…** and **Verify HAP Signature…** for prebuilt HAPs (also in the Explorer context menu).
- **Search SDK API** (with insert-import) and **Search OpenHarmony Docs** (with on-demand docs download).
- SDK Manager: command-line tools version and edition, the HarmonyOS SDK in use, the emulator architecture, and **Install from archive…** for full SDKs from the daily builds.
- Native C++ and HarmonyOS App project templates (synced from the CLI); the Empty Ability template's ohosTest module now builds.
- `oniro: build` and `oniro: check ArkTS` tasks that report to the Problems panel; `Ctrl+F5` runs the app.
- Settings: `oniro.hdcPath`, `oniro.harmonyosSdkPath`, `oniro.sdkUrlBase`, `oniro.docsDir`, `oniro.emulatorBootTimeout`, `oniro.checkArktsOnSave`, `oniro.openHilogOnLaunch`.
- Unit, activation and integration test suites (`npm test`, `npm run test:integration`).

### Changed
- Updated `@oniroproject/core` from 0.10.0 to 0.19.0, and the ArkTS language server packages to their latest 1.3.x.
- The sidebar is grouped into Project, Device, Emulator, Tools and Doctor, and shows the target device and emulator health live.
- **Run** uses the selected or single connected device and only starts the emulator when there is none; it waits for the emulator to finish booting instead of sleeping 10 s, and installs the HAP the build just produced.
- Starting the emulator waits for boot to complete (`oniro.emulatorBootTimeout`) and keeps its log in the extension's storage.
- A project with no `default` product builds its first product.
- Create Project defaults to the newest installed SDK the installed command-line tools can build.
- `oniro.emulatorUrl`, `oniro.cmdToolsUrlLinux` and `oniro.hapPath` default to empty, so core's defaults apply: the emulator matching the host's architecture, and installing whatever HAP the build produced.
- The `oniro-debug` launch configuration runs Oniro: Run and no longer tries to start a debug adapter that does not exist.

### Fixed
- Installing on a project whose product is not `default` (or whose module is not `entry`): the `oniro.hapPath` default pinned `entry/build/default/...`, which kept core from finding the HAP the build produced.
- Launching the app opened a new HiLog viewer tab each time; the viewer is now reused, and it reports when the log stream ends.
- Build Configuration labels were white, unreadable on light themes.
- Install failed with "HAP file not found" whenever the build produced a HAP other than `entry/build/default/outputs/default/entry-default-signed.hap` (an unsigned HarmonyOS build, another product or module), because Create Project pinned that path as `oniro.hapPath` in the new project's `.vscode/settings.json`. New projects no longer get the setting, and in existing projects that generated value is ignored, so the HAP the build produced is installed. A path set by hand is still honoured.

## [0.6.1]

### Fixed
- Hilog viewer: log lines are now split on CRLF as well as LF, fixing garbled entries on Windows. 0.6.0 fixed this in `@oniroproject/core`, but the extension's own hilog stream parser still split on LF only.

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