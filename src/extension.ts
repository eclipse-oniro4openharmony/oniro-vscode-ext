import * as vscode from 'vscode';
import {
	VERSION,
	attemptHdcConnection,
	findAppProcessId,
	generateSigningConfigs,
	getOhosBaseSdkHome,
	installApp,
	launchApp,
	startEmulator,
	stopEmulator,
} from '@oniroproject/core';
import { vscodeConfigProvider, vscodeLogger, tokenToSignal } from './adapters';
import { oniroLogChannel } from './utils/logger';
import { runBuild, getWorkspaceRoot } from './utils/buildHelpers';
import { registerHilogViewerCommand } from './hilogViewer';
import { OniroTreeDataProvider, OniroCommands } from './OniroTreeDataProvider';
import { registerSdkManagerCommand } from './sdkManager';
import { OniroDebugConfigurationProvider } from './providers/OniroDebugConfigurationProvider';
import { OniroTaskProvider } from './providers/oniroTaskProvider';
import { registerCreateProjectCommand } from './createProject';
import { registerBuildConfigCommand } from './buildConfig';
import { startLanguageClient, stopLanguageClient } from './languageClient';

/**
 * Wait until hdc successfully connects to the emulator, or until the user cancels.
 * Polls every 3 seconds — matches the prior UX.
 */
async function waitForHdc(
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	token: vscode.CancellationToken,
): Promise<boolean> {
	while (!token.isCancellationRequested) {
		progress.report({ message: 'Waiting for HDC connection...' });
		if (await attemptHdcConnection(vscodeConfigProvider, undefined, vscodeLogger)) {
			return true;
		}
		oniroLogChannel.appendLine('[emulator] Waiting for HDC connection...');
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	return false;
}

async function detectProcessIdAndShowHilog(
	token?: vscode.CancellationToken,
	progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<void> {
	if (progress) {
		progress.report({ message: 'Detecting app process ID...' });
	}
	oniroLogChannel.appendLine('[Oniro] Detecting app process ID...');

	const projectDir = getWorkspaceRoot();
	oniroLogChannel.appendLine('[Oniro] Project directory: ' + projectDir);

	let pid: string;
	try {
		if (token) {
			pid = await Promise.race([
				findAppProcessId(vscodeConfigProvider, projectDir, vscodeLogger),
				new Promise<string>((_, reject) => {
					token.onCancellationRequested(() => {
						reject(new Error('Cancelled by user'));
					});
				}),
			]);
		} else {
			pid = await findAppProcessId(vscodeConfigProvider, projectDir, vscodeLogger);
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

	if (token?.isCancellationRequested) { return; }

	vscode.commands.executeCommand('oniro-ide.showHilogViewer', { processId: pid, severity: 'INFO' });
}

export function activate(context: vscode.ExtensionContext) {
	oniroLogChannel.appendLine(`[info] @oniroproject/core ${VERSION} loaded.`);
	startLanguageClient(context);

	const signDisposable = vscode.commands.registerCommand(OniroCommands.SIGN, async () => {
		try {
			const projectDir = getWorkspaceRoot();
			oniroLogChannel.appendLine('[sign] Generating signing configs...');
			generateSigningConfigs({
				projectDir,
				sdkHome: getOhosBaseSdkHome(vscodeConfigProvider),
				logger: vscodeLogger,
			});
			oniroLogChannel.appendLine('[sign] Signing config generation complete.');
			vscode.window.showInformationMessage('Signing completed!');
		} catch (err) {
			vscode.window.showErrorMessage(`Signing failed: ${err}`);
		}
	});

	const startEmulatorDisposable = vscode.commands.registerCommand(OniroCommands.START_EMULATOR, async () => {
		try {
			await startEmulator({ config: vscodeConfigProvider, logger: vscodeLogger });
			await vscode.window.withProgress({
				title: 'Oniro Emulator: Connecting HDC',
				location: vscode.ProgressLocation.Notification,
				cancellable: true,
			}, async (progress, token) => {
				const connected = await waitForHdc(progress, token);
				if (connected) {
					vscode.window.showInformationMessage('HDC connected!');
				} else {
					oniroLogChannel.appendLine('[emulator] HDC connection cancelled by user.');
				}
			});
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to start emulator: ${err}`);
		}
	});

	const stopEmulatorDisposable = vscode.commands.registerCommand(OniroCommands.STOP_EMULATOR, async () => {
		try {
			await stopEmulator(vscodeLogger);
			vscode.window.showInformationMessage('Emulator stopped successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to stop emulator: ${err}`);
		}
	});

	const connectEmulatorDisposable = vscode.commands.registerCommand(OniroCommands.CONNECT_EMULATOR, async () => {
		try {
			const connected = await attemptHdcConnection(vscodeConfigProvider, undefined, vscodeLogger);
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
			const projectDir = getWorkspaceRoot();
			await installApp({
				config: vscodeConfigProvider,
				projectDir,
				logger: vscodeLogger,
			});
			vscode.window.showInformationMessage('App installed successfully!');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to install app: ${err}`);
		}
	});

	const launchDisposable = vscode.commands.registerCommand(OniroCommands.LAUNCH_APP, async () => {
		try {
			const projectDir = getWorkspaceRoot();
			await launchApp({
				config: vscodeConfigProvider,
				projectDir,
				logger: vscodeLogger,
			});
			vscode.window.showInformationMessage('App launched successfully!');

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
			cancellable: true,
		};
		await vscode.window.withProgress(progressOptions, async (progress, token) => {
			const bridge = tokenToSignal(token);
			try {
				const projectDir = getWorkspaceRoot();

				progress.report({ message: 'Starting emulator...' });
				await startEmulator({
					config: vscodeConfigProvider,
					logger: vscodeLogger,
					abortSignal: bridge.signal,
				});
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Connecting to emulator...' });
				await attemptHdcConnection(vscodeConfigProvider, undefined, vscodeLogger);
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Waiting for emulator to boot...' });
				await new Promise((resolve) => setTimeout(resolve, 10000));
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Building app...' });
				await runBuild({ projectDir });
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Installing app...' });
				await installApp({ config: vscodeConfigProvider, projectDir, logger: vscodeLogger });
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Launching app...' });
				await launchApp({ config: vscodeConfigProvider, projectDir, logger: vscodeLogger });
				if (token.isCancellationRequested) { return; }

				await detectProcessIdAndShowHilog(token, progress);

				vscode.window.showInformationMessage('Oniro: All steps completed successfully! Logs are now streaming.');
			} catch (err) {
				if (err instanceof Error && err.message === 'Cancelled by user') {
					vscode.window.showWarningMessage('Oniro: Run All cancelled by user.');
					return;
				}
				vscode.window.showErrorMessage(`Oniro: Run All failed: ${err}`);
			} finally {
				bridge.dispose();
			}
		});
	});

	const oniroTreeDataProvider = new OniroTreeDataProvider();
	vscode.window.registerTreeDataProvider('oniroMainView', oniroTreeDataProvider);
	vscode.commands.registerCommand('oniro-ide.refreshTreeView', () => oniroTreeDataProvider.refresh());

	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider(
			'oniro-debug',
			new OniroDebugConfigurationProvider(),
		),
	);

	context.subscriptions.push(
		vscode.tasks.registerTaskProvider('oniro', new OniroTaskProvider()),
	);

	registerHilogViewerCommand(context);
	registerSdkManagerCommand(context);
	registerCreateProjectCommand(context);
	registerBuildConfigCommand(context);

	context.subscriptions.push(
		signDisposable,
		startEmulatorDisposable,
		stopEmulatorDisposable,
		connectEmulatorDisposable,
		installDisposable,
		launchDisposable,
		runAllDisposable,
	);
}

export function deactivate(): Thenable<void> | undefined {
	return stopLanguageClient();
}
