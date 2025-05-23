// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { onirobuilderBuild, onirobuilderSign } from './utils/onirobuilder';
import { startEmulator, stopEmulator, attemptHdcConnection } from './utils/emulatorManager';
import { installApp, launchApp, findAppProcessId } from './utils/hdcManager';
import { registerHilogViewerCommand } from './hilogViewer';
import { oniroLogChannel } from './utils/logger';
import { OniroTreeDataProvider, OniroCommands } from './OniroTreeDataProvider';
import { registerSdkManagerCommand } from './sdkManager';
import { OniroDebugConfigurationProvider } from './providers/OniroDebugConfigurationProvider';
import { OniroTaskProvider } from './oniroTaskProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const buildDisposable = vscode.commands.registerCommand(OniroCommands.BUILD, async () => {
		try {
			await onirobuilderBuild();
			vscode.window.showInformationMessage('Build completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`Build failed: ${err}`);
		}
	});

	const signDisposable = vscode.commands.registerCommand(OniroCommands.SIGN, async () => {
		try {
			await onirobuilderSign();
			vscode.window.showInformationMessage('Signing completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`Signing failed: ${err}`);
		}
	});

	const startEmulatorDisposable = vscode.commands.registerCommand(OniroCommands.START_EMULATOR, async () => {
		try {
			await startEmulator();
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to start emulator: ${err}`);
		}
	});

	const stopEmulatorDisposable = vscode.commands.registerCommand(OniroCommands.STOP_EMULATOR, async () => {
		try {
			await stopEmulator();
			vscode.window.showInformationMessage('Emulator stopped successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to stop emulator: ${err}`);
		}
	});

	const connectEmulatorDisposable = vscode.commands.registerCommand(OniroCommands.CONNECT_EMULATOR, async () => {
		try {
			const connected = await attemptHdcConnection();
			if (connected) {
				vscode.window.showInformationMessage('Emulator connected successfully!');
			} else {
				throw new Error('Failed to connect emulator.');
			}
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to connect emulator: ${err}`);
		}
	});

	const installDisposable = vscode.commands.registerCommand(OniroCommands.INSTALL_APP, async () => {
		try {
			await installApp();
			vscode.window.showInformationMessage('App installed successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to install app: ${err}`);
		}
	});

	const launchDisposable = vscode.commands.registerCommand(OniroCommands.LAUNCH_APP, async () => {
		try {
			await launchApp();
			vscode.window.showInformationMessage('App launched successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to launch app: ${err}`);
		}
	});

	const runAllDisposable = vscode.commands.registerCommand(OniroCommands.RUN_ALL, async () => {
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
				await attemptHdcConnection();
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

	// Register Oniro Tree View
	const oniroTreeDataProvider = new OniroTreeDataProvider();
	vscode.window.registerTreeDataProvider('oniroMainView', oniroTreeDataProvider);
	vscode.commands.registerCommand('oniro-ide.refreshTreeView', () => oniroTreeDataProvider.refresh());

	// Register Oniro DebugConfigurationProvider
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider(
			'oniro-debug',
			new OniroDebugConfigurationProvider()
		)
	);

	// Register Oniro Task Provider
	context.subscriptions.push(
		vscode.tasks.registerTaskProvider('oniro', new OniroTaskProvider())
	);

	registerHilogViewerCommand(context);
	registerSdkManagerCommand(context);

	context.subscriptions.push(
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
