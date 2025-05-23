# Oniro IDE

Oniro IDE is a lightweight, integrated development environment as a Visual Studio Code Extension tailored for Oniro/OpenHarmony application development. It provides a streamlined workflow for building, signing, deploying, running, and debugging Oniro apps, as well as managing SDKs and emulators.

## Features

- **Oniro Tree View**: Access all Oniro development actions from a dedicated sidebar, including build, sign, emulator control, app install/launch, SDK Manager, and HiLog Viewer.
- **Build and Sign**: Compile and sign your Oniro/OpenHarmony application with a single command.
- **Emulator Management**: Start, stop, and connect to the Oniro emulator directly from VS Code.
- **App Deployment**: Install and launch `.hap` packages on the emulator or connected device.
- **Run All**: One-click workflow to start the emulator, build, install, and launch your app, then open the HiLog Viewer for live logs.
- **HiLog Viewer**: View and filter real-time logs from your running Oniro app within VS Code.
- **SDK Manager**: Install, update, or remove OpenHarmony SDKs, command-line tools, and the Oniro emulator via a graphical interface.
- **Oniro Tasks**: Run Oniro-specific build tasks from the VS Code task system.
- **Debugging**: Debug Oniro applications using the "Oniro Debug" configuration.

## Requirements

- Node.js (LTS recommended)
- Java SDK (for building/signing apps)
- Required native tools (as per Oniro/OpenHarmony SDK requirements)
- Oniro/OpenHarmony SDK (managed via the SDK Manager)

Ensure all dependencies are installed and available in your `PATH`.

## Installation

### From Marketplace

1. Open VS Code and go to the Extensions view (`Ctrl+Shift+X`).
2. Search for **Oniro IDE** and click **Install**.

### From Source (Development)

```bash
# Clone the repository
git clone https://github.com/frankplus/oniro-ide
cd oniro-ide

# Install dependencies and build
npm install
npm run compile

# Open in VS Code and launch extension host
code .
# Press F5 to start the Extension Development Host
```

## Usage

1. Install and enable the Oniro IDE extension in VS Code.
2. Use the Oniro sidebar to access all main actions, or open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and search for Oniro commands.
3. Typical workflow:
   - **SDK & Tools Setup**: Open the **SDK Manager** from the sidebar to install or update the required OpenHarmony SDKs, command-line tools, and the Oniro emulator before starting development.
   - **Signature Configs**: If your application does not already have signing configurations, generate them using the Oniro IDE (see sidebar or command palette for signature config generation commands).
   - **Build and Sign**: Use **Oniro: Build App** and **Oniro: Sign App** to prepare your application.
   - **Emulator**: Start the emulator with **Oniro: Start Emulator** and connect if needed (**Oniro: Connect Emulator**).
   - **Deploy**: Install your `.hap` package using **Oniro: Install App** and launch it with **Oniro: Launch App**.
   - **Run All**: Use **Oniro: Run All (Emulator, Build, Install, Launch)** for a full automated flow, including log streaming.
   - **HiLog Viewer**: View logs for your running app with **Oniro: Show HiLog Viewer**.

## Available Commands

- `oniro-ide.runAll`: Run all steps (start emulator, build, install, launch, and open HiLog Viewer)
- `oniro-ide.build`: Build the Oniro app
- `oniro-ide.sign`: Sign the Oniro app
- `oniro-ide.startEmulator`: Start the Oniro emulator
- `oniro-ide.stopEmulator`: Stop the Oniro emulator
- `oniro-ide.connectEmulator`: Connect to the running emulator
- `oniro-ide.installApp`: Install the app on the emulator/device
- `oniro-ide.launchApp`: Launch the app on the emulator/device
- `oniro-ide.openSdkManager`: Open the Oniro SDK Manager
- `oniro-ide.showHilogViewer`: Open the Oniro HiLog log viewer

## Extension Settings

This extension contributes the following settings (see VS Code settings for details):

- `oniro.sdkRootDir`: Root directory where OpenHarmony SDKs are installed. Default: `${userHome}/setup-ohos-sdk`
- `oniro.cmdToolsPath`: Directory where OpenHarmony command-line tools are installed. Default: `${userHome}/command-line-tools`
- `oniro.emulatorDir`: Directory where Oniro emulator is installed. Default: `${userHome}/oniro-emulator`

## Known Issues

- The commands are developed and verified only for the Linux environments
- Please report issues and feature requests via the GitHub repository.

## Release Notes

### 0.0.1
Initial release: Oniro Tree View, build/sign/deploy workflow, emulator management, SDK Manager, HiLog Viewer, and debugging support.

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## For more information

- [Visual Studio Code's Extension API](https://code.visualstudio.com/api)
- [Oniro Project](https://oniroproject.org/)
- [OpenHarmony Documentation](https://www.openharmony.cn/en/)

## ArkTS Language Integration

For additional integration for the ArkTS language, use the [ArkTS VS Code plugin](https://github.com/Groupguanfang/arkTS), which supports source code navigation and completion. It also supports codelinter to detect errors.

**Enjoy developing with Oniro IDE!**
