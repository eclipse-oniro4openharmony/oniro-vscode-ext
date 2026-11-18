import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import {
	type HilogLevel,
	type RunningProcess,
	listRunningProcesses,
	parseHilogLine,
	setHilogLevel,
	streamHilog,
} from '@oniroproject/core';
import { OniroCommands } from './commandIds';
import { oniroLogChannel } from './utils/logger';
import { vscodeConfigProvider, vscodeLogger } from './adapters';

const VALID_LEVELS: readonly HilogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

function normalizeLevel(severity: unknown): HilogLevel {
	if (typeof severity === 'string') {
		const upper = severity.toUpperCase();
		if ((VALID_LEVELS as readonly string[]).includes(upper)) {
			return upper as HilogLevel;
		}
	}
	return 'INFO';
}

let currentPanel: vscode.WebviewPanel | undefined;

export function registerHilogViewerCommand(context: vscode.ExtensionContext) {
	const showHilogViewerDisposable = vscode.commands.registerCommand(
		OniroCommands.SHOW_HILOG_VIEWER,
		(args?: { processId?: string; severity?: string }) => {
			// One viewer: launching the app again re-targets it instead of piling up tabs.
			if (currentPanel) {
				currentPanel.reveal(undefined, true);
				if (args?.processId || args?.severity) {
					currentPanel.webview.postMessage({ command: 'init', processId: args.processId, severity: args.severity });
				}
				return;
			}

			const panel = vscode.window.createWebviewPanel(
				'oniroHilogViewer',
				'Oniro HiLog Viewer',
				{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
				{
					enableScripts: true,
					retainContextWhenHidden: true,
				},
			);
			currentPanel = panel;

			panel.webview.html = getHilogWebviewContent(context);

			let hdcProcess: ChildProcessWithoutNullStreams | undefined;
			// Bumped by every start/stop, so a start that finishes after a newer one drops its stream.
			let generation = 0;
			const stop = () => {
				generation++;
				if (hdcProcess) {
					hdcProcess.removeAllListeners('exit');
					hdcProcess.kill();
					hdcProcess = undefined;
				}
			};

			const messageListener = panel.webview.onDidReceiveMessage(async message => {
				if (message.command === 'webviewReady' && (args?.processId || args?.severity)) {
					panel.webview.postMessage({
						command: 'init',
						processId: args?.processId,
						severity: args?.severity,
					});
				}
				if (message.command === 'startLog') {
					const { processId, severity } = message;
					stop();
					const mine = generation;
					const proc = await startHilogStream(processId, severity, panel);
					if (mine !== generation) {
						proc?.removeAllListeners('exit');
						proc?.kill();
						return;
					}
					hdcProcess = proc;
					if (proc) {
						proc.on('exit', (code) => {
							if (hdcProcess !== proc) { return; }
							hdcProcess = undefined;
							oniroLogChannel.appendLine(`[HiLog] Log stream ended (hdc exited with ${code}).`);
							panel.webview.postMessage({ command: 'streamingStopped' });
						});
						panel.webview.postMessage({ command: 'streamingStarted' });
					} else {
						panel.webview.postMessage({ command: 'streamingStopped' });
					}
				}
				if (message.command === 'stopLog') {
					stop();
					panel.webview.postMessage({ command: 'streamingStopped' });
				}
				if (message.command === 'refreshProcesses') {
					try {
						const result = await listRunningProcesses(vscodeConfigProvider, { logger: vscodeLogger });
						const processes = Array.isArray(result) ? (result as RunningProcess[]) : [];
						oniroLogChannel.appendLine(`[HiLog] Found ${processes.length} processes`);
						panel.webview.postMessage({
							command: 'processesUpdated',
							processes,
						});
					} catch (error) {
						oniroLogChannel.appendLine(`[HiLog] Failed to get processes: ${error}`);
						panel.webview.postMessage({
							command: 'processesError',
							error: error instanceof Error ? error.message : 'Unknown error',
						});
					}
				}
			});

			panel.onDidDispose(() => {
				stop();
				messageListener.dispose();
				if (currentPanel === panel) {
					currentPanel = undefined;
				}
			});
		},
	);

	context.subscriptions.push(showHilogViewerDisposable, { dispose: () => currentPanel?.dispose() });
}

async function startHilogStream(
	processId: string | undefined,
	severity: string | undefined,
	panel: vscode.WebviewPanel,
): Promise<ChildProcessWithoutNullStreams | undefined> {
	const level = normalizeLevel(severity);

	try {
		await setHilogLevel({ config: vscodeConfigProvider, level, logger: vscodeLogger });
	} catch (err) {
		oniroLogChannel.appendLine(`[HiLog] Failed to set buffer level: ${err}`);
	}

	let hdcProcess: ChildProcessWithoutNullStreams;
	try {
		hdcProcess = streamHilog({
			config: vscodeConfigProvider,
			processId: processId && processId.trim() !== '' ? processId : undefined,
		});
	} catch (err) {
		vscode.window.showErrorMessage(`Cannot stream the device log: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}
	hdcProcess.on('error', (err) => oniroLogChannel.appendLine(`[HiLog] ${err.message}`));

	let leftover = '';
	hdcProcess.stdout.on('data', (data: Buffer) => {
		const chunk = leftover + data.toString();
		const lines = chunk.split(/\r?\n/);
		leftover = lines.pop() || '';
		for (const line of lines) {
			const parsed = parseHilogLine(line);
			if (parsed) {
				panel.webview.postMessage({ command: 'log', log: parsed });
			} else if (line.trim() !== '') {
				oniroLogChannel.appendLine(`[HiLog parse error] ${line}`);
			}
		}
	});
	hdcProcess.stdout.on('end', () => {
		if (leftover) {
			const parsed = parseHilogLine(leftover);
			if (parsed) {
				panel.webview.postMessage({ command: 'log', log: parsed });
			} else {
				oniroLogChannel.appendLine(`[HiLog parse error] ${leftover}`);
			}
		}
	});
	hdcProcess.stderr.on('data', (data: Buffer) => {
		oniroLogChannel.appendLine(`[HiLog stderr] ${data.toString()}`);
	});

	return hdcProcess;
}

function getHilogWebviewContent(context: vscode.ExtensionContext): string {
	const htmlPath = path.join(context.extensionPath, 'out', 'hilogWebview.html');
	try {
		return fs.readFileSync(htmlPath, 'utf8');
	} catch (err) {
		return `<html><body><h2>Failed to load HiLog Viewer UI</h2><pre>${err}</pre></body></html>`;
	}
}
