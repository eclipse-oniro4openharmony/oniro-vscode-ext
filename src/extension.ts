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
import { OniroTaskProvider } from './providers/oniroTaskProvider';

// Helper function to detect app process ID and open HiLog viewer
async function detectProcessIdAndShowHilog(token?: vscode.CancellationToken, progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
	if (progress) {
		progress.report({ message: 'Detecting app process ID...' });
	}
	oniroLogChannel.appendLine('[Oniro] Detecting app process ID...');
	
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		oniroLogChannel.appendLine('[Oniro] No workspace folder found.');
		throw new Error('No workspace folder found.');
	}
	
	const projectDir = workspaceFolders[0].uri.fsPath;
	oniroLogChannel.appendLine('[Oniro] Project directory: ' + projectDir);
	
	let pid: string;
	try {
		if (token) {
			pid = await Promise.race([
				findAppProcessId(projectDir),
				new Promise<string>((_, reject) => {
					token.onCancellationRequested(() => {
						reject(new Error('Cancelled by user'));
					});
				})
			]);
		} else {
			pid = await findAppProcessId(projectDir);
		}
	} catch (err) {
		oniroLogChannel.appendLine('[Oniro] ' + err);
		if (err instanceof Error && err.message === 'Cancelled by user') {
			if (token?.isCancellationRequested) {
				vscode.window.showWarningMessage('Oniro: Process detection cancelled by user.');
				return;
			}
		}
		throw err;
	}
	
	if (token?.isCancellationRequested) return;
	
	// Open HiLog viewer and start logging using the main command, passing processId and severity
	vscode.commands.executeCommand('oniro-ide.showHilogViewer', { processId: pid, severity: 'INFO' });
}

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
			
			// Detect process ID and show HiLog viewer
			try {
				await detectProcessIdAndShowHilog();
				vscode.window.showInformationMessage('HiLog viewer opened with app process ID.');
			} catch (err) {
				vscode.window.showWarningMessage(`App launched but failed to detect process ID: ${err}`);
			}
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to launch app: ${err}`);
		}
	});

	const runAllDisposable = vscode.commands.registerCommand(OniroCommands.RUN_ALL, async () => {
		const progressOptions = {
			title: 'Oniro: Running All Steps',
			location: vscode.ProgressLocation.Notification,
			cancellable: true // Allow cancellation
		};
		await vscode.window.withProgress(progressOptions, async (progress, token) => {
			try {
				progress.report({ message: 'Starting emulator...' });
				await startEmulator();
				if (token.isCancellationRequested) return;
				progress.report({ message: 'Connecting to emulator...' });
				await attemptHdcConnection();
				if (token.isCancellationRequested) return;
				progress.report({ message: 'Waiting for emulator to boot...' });
				await new Promise(resolve => setTimeout(resolve, 10000));
				if (token.isCancellationRequested) return;
				progress.report({ message: 'Building app...' });
				await onirobuilderBuild();
				if (token.isCancellationRequested) return;
				progress.report({ message: 'Installing app...' });
				await installApp();
				if (token.isCancellationRequested) return;
				progress.report({ message: 'Launching app...' });
				await launchApp();
				if (token.isCancellationRequested) return;

				// Detect process ID and open HiLog viewer
				await detectProcessIdAndShowHilog(token, progress);

				vscode.window.showInformationMessage('Oniro: All steps completed successfully! Logs are now streaming.');
			} catch (err) {
				if (err instanceof Error && err.message === 'Cancelled by user') {
					vscode.window.showWarningMessage('Oniro: Run All cancelled by user.');
					return;
				}
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
