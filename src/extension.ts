// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { onirobuilderInit, onirobuilderBuild, onirobuilderSign } from './utils/onirobuilder';
import { startEmulator, stopEmulator, connectEmulator } from './utils/emulatorManager';
import { installApp, launchApp } from './utils/hdcManager';
import { OniroTaskProvider } from './providers/OniroTaskProvider';
import { OniroDebugProvider } from './providers/OniroDebugProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "oniro-ide" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('oniro-ide.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Oniro IDE!');
	});

	const initDisposable = vscode.commands.registerCommand('oniro-ide.initSdk', async () => {
		try {
			await onirobuilderInit();
			vscode.window.showInformationMessage('Oniro SDK initialization completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`SDK initialization failed: ${err}`);
		}
	});

	const buildSignDisposable = vscode.commands.registerCommand('oniro-ide.buildAndSign', async () => {
		try {
			await onirobuilderSign();
			await onirobuilderBuild();
			vscode.window.showInformationMessage('Build and signing completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`Build or signing failed: ${err}`);
		}
	});

	const startEmulatorDisposable = vscode.commands.registerCommand('oniro-ide.startEmulator', async () => {
		try {
			await startEmulator();
			vscode.window.showInformationMessage('Emulator started successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to start emulator: ${err}`);
		}
	});

	const stopEmulatorDisposable = vscode.commands.registerCommand('oniro-ide.stopEmulator', async () => {
		try {
			await stopEmulator();
			vscode.window.showInformationMessage('Emulator stopped successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to stop emulator: ${err}`);
		}
	});

	const connectEmulatorDisposable = vscode.commands.registerCommand('oniro-ide.connectEmulator', async () => {
		try {
			await connectEmulator();
			vscode.window.showInformationMessage('Emulator connected successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to connect emulator: ${err}`);
		}
	});

	const installDisposable = vscode.commands.registerCommand('oniro-ide.installApp', async () => {
		try {
			await installApp();
			vscode.window.showInformationMessage('App installed successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to install app: ${err}`);
		}
	});

	const launchDisposable = vscode.commands.registerCommand('oniro-ide.launchApp', async () => {
		try {
			await launchApp();
			vscode.window.showInformationMessage('App launched successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to launch app: ${err}`);
		}
	});

	// Register Oniro Task Provider
	const oniTasks = vscode.tasks.registerTaskProvider(OniroTaskProvider.OniroType, new OniroTaskProvider());
	context.subscriptions.push(oniTasks);

	// Register Oniro Debug Configuration Provider
	const oniDebug = vscode.debug.registerDebugConfigurationProvider('oniro-debug', new OniroDebugProvider());
	context.subscriptions.push(oniDebug);

	context.subscriptions.push(disposable, initDisposable, buildSignDisposable, startEmulatorDisposable, stopEmulatorDisposable, connectEmulatorDisposable, installDisposable, launchDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
