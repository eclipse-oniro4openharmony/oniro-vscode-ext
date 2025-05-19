// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { onirobuilderInit, onirobuilderBuild, onirobuilderSign } from './utils/onirobuilder';
import { startEmulator, stopEmulator, connectEmulator } from './utils/emulatorManager';
import { installApp, launchApp, getBundleName, findAppProcessId } from './utils/hdcManager';
import { OniroTaskProvider } from './providers/OniroTaskProvider';
import { OniroDebugProvider } from './providers/OniroDebugProvider';
import { registerHilogViewerCommand } from './hilogViewer';
import { oniroLogChannel } from './utils/logger';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	oniroLogChannel.appendLine('Congratulations, your extension "oniro-ide" is now active!');

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

	const buildDisposable = vscode.commands.registerCommand('oniro-ide.build', async () => {
		try {
			await onirobuilderBuild();
			vscode.window.showInformationMessage('Build completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`Build failed: ${err}`);
		}
	});

	const signDisposable = vscode.commands.registerCommand('oniro-ide.sign', async () => {
		try {
			await onirobuilderSign();
			vscode.window.showInformationMessage('Signing completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`Signing failed: ${err}`);
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

	const runAllDisposable = vscode.commands.registerCommand('oniro-ide.runAll', async () => {
		const progressOptions = {
			title: 'Oniro: Running All Steps',
			location: vscode.ProgressLocation.Notification,
			cancellable: false
		};
		await vscode.window.withProgress(progressOptions, async (progress) => {
			try {
				progress.report({ message: 'Starting emulator...' });
				await startEmulator();
				progress.report({ message: 'Connecting to emulator...' });
				await connectEmulator();
				progress.report({ message: 'Building app...' });
				await onirobuilderBuild();
				progress.report({ message: 'Installing app...' });
				await installApp();
				progress.report({ message: 'Launching app...' });
				await launchApp();

				// Find process ID and open HiLog viewer
				progress.report({ message: 'Detecting app process ID...' });
				oniroLogChannel.appendLine('[Oniro RunAll] Detecting app process ID...');
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					oniroLogChannel.appendLine('[Oniro RunAll] No workspace folder found.');
					throw new Error('No workspace folder found.');
				}
				const projectDir = workspaceFolders[0].uri.fsPath;
				oniroLogChannel.appendLine('[Oniro RunAll] Project directory: ' + projectDir);
				let pid: string;
				try {
					pid = await findAppProcessId(projectDir);
					oniroLogChannel.appendLine('[Oniro RunAll] Found app process id: ' + pid);
				} catch (err) {
					oniroLogChannel.appendLine('[Oniro RunAll] ' + err);
					throw err;
				}
				// Open HiLog viewer and start logging using the main command, passing processId and severity
				vscode.commands.executeCommand('oniro-ide.showHilogViewer', { processId: pid, severity: 'INFO' });

				vscode.window.showInformationMessage('Oniro: All steps completed successfully! Logs are now streaming.');
			} catch (err) {
				vscode.window.showErrorMessage(`Oniro: Run All failed: ${err}`);
			}
		});
	});

	registerHilogViewerCommand(context);

	context.subscriptions.push(
		disposable,
		initDisposable,
		buildDisposable,
		signDisposable,
		startEmulatorDisposable,
		stopEmulatorDisposable,
		connectEmulatorDisposable,
		installDisposable,
		launchDisposable,
		runAllDisposable
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
