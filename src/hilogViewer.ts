import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	type HilogLevel,
	type RunningProcess,
	listRunningProcesses,
	parseHilogLine,
	setHilogLevel,
	streamHilog,
} from '@oniroproject/core';
import { OniroCommands } from './OniroTreeDataProvider';
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

export function registerHilogViewerCommand(context: vscode.ExtensionContext) {
	const showHilogViewerDisposable = vscode.commands.registerCommand(
		OniroCommands.SHOW_HILOG_VIEWER,
		(args?: { processId?: string; severity?: string }) => {
			const panel = vscode.window.createWebviewPanel(
				'oniroHilogViewer',
				'Oniro HiLog Viewer',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
				},
			);

			panel.webview.html = getHilogWebviewContent(context);

			let hdcProcess: import('child_process').ChildProcessWithoutNullStreams | undefined;

			panel.webview.onDidReceiveMessage(
				async message => {
					if (message.command === 'startLog') {
						const { processId, severity } = message;
						if (hdcProcess) {
							hdcProcess.kill();
							panel.webview.postMessage({ command: 'streamingStopped' });
						}
						hdcProcess = await startHilogStream(processId, severity, panel);
						if (hdcProcess) {
							panel.webview.postMessage({ command: 'streamingStarted' });
						} else {
							panel.webview.postMessage({ command: 'streamingStopped' });
						}
					}
					if (message.command === 'stopLog' && hdcProcess) {
						hdcProcess.kill();
						hdcProcess = undefined;
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
				},
				undefined,
				context.subscriptions,
			);

			const readyListener = panel.webview.onDidReceiveMessage(
				message => {
					if (message.command === 'webviewReady' && (args?.processId || args?.severity)) {
						panel.webview.postMessage({
							command: 'init',
							processId: args?.processId,
							severity: args?.severity,
						});
						readyListener.dispose();
					}
				},
				undefined,
				context.subscriptions,
			);

			panel.onDidDispose(() => {
				if (hdcProcess) {
					hdcProcess.kill();
					panel.webview.postMessage({ command: 'streamingStopped' });
				}
			});
		},
	);

	context.subscriptions.push(showHilogViewerDisposable);
}

async function startHilogStream(
	processId: string | undefined,
	severity: string | undefined,
	panel: vscode.WebviewPanel,
): Promise<import('child_process').ChildProcessWithoutNullStreams | undefined> {
	const level = normalizeLevel(severity);

	try {
		await setHilogLevel({ config: vscodeConfigProvider, level, logger: vscodeLogger });
	} catch (err) {
		oniroLogChannel.appendLine(`[HiLog] Failed to set buffer level: ${err}`);
	}

	const hdcProcess = streamHilog({
		config: vscodeConfigProvider,
		processId: processId && processId.trim() !== '' ? processId : undefined,
	});

	let leftover = '';
	hdcProcess.stdout.on('data', (data: Buffer) => {
		const chunk = leftover + data.toString();
		const lines = chunk.split('\n');
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
