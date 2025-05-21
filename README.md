# oniro-ide README

This is the README for your extension "oniro-ide". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Installation

### From Marketplace

1. Open VS Code and go to the Extensions view (`Ctrl+Shift+X`).
2. Search for **Oniro IDE** and click **Install**.

### From Source (Development)

```bash
# Clone the repository
git clone https://github.com/your-org/oniro-ide.git
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
2. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
4. Use **Oniro IDE: Build and Sign** (`oniro-ide.buildAndSign`) to compile and sign your application.
5. Start the emulator via **Oniro IDE: Start Emulator** (`oniro-ide.startEmulator`) before deploying or testing your app.
6. When finished, stop the emulator with **Oniro IDE: Stop Emulator** (`oniro-ide.stopEmulator`).
7. Install your `.hap` package on the emulator or device using **Oniro IDE: Install App** (`oniro-ide.installApp`).
8. Launch your application with **Oniro IDE: Launch App** (`oniro-ide.launchApp`).
9. View and run predefined Oniro tasks by opening the **Run Task** menu (`Ctrl+Shift+P` → `Tasks: Run Task`) and selecting an Oniro task.
10. Debug your application by choosing the **Oniro Debug** configuration in the Run view and starting a debug session.

Make sure you have all dependencies (Node.js, Java SDK, and required native tools) installed and configured in your PATH to ensure each command runs successfully.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
