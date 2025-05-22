import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OniroCommands } from './OniroTreeDataProvider';
import { getHdcPath } from './utils/sdkUtils';
import { oniroLogChannel } from './utils/logger';

export function registerHilogViewerCommand(context: vscode.ExtensionContext) {
	const showHilogViewerDisposable = vscode.commands.registerCommand(
		OniroCommands.SHOW_HILOG_VIEWER,
		(args?: { processId?: string, severity?: string }) => {
			const panel = vscode.window.createWebviewPanel(
				'oniroHilogViewer',
				'Oniro HiLog Viewer',
				vscode.ViewColumn.One,
				{
					enableScripts: true
				}
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
						hdcProcess = await startHilogProcess(processId, severity, panel);
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
				},
				undefined,
				context.subscriptions
			);

			// Use webview 'onDidReceiveMessage' only for messages from webview, not for extension->webview
			// Instead, use 'panel.webview.postMessage' after webview is loaded
			// Wait for webview to signal it's ready
			const readyListener = panel.webview.onDidReceiveMessage(
				message => {
					if (message.command === 'webviewReady' && (args?.processId || args?.severity)) {
						panel.webview.postMessage({
							command: 'init',
							processId: args?.processId,
							severity: args?.severity
						});
						readyListener.dispose();
					}
				},
				undefined,
				context.subscriptions
			);

			panel.onDidDispose(() => {
				if (hdcProcess) {
					hdcProcess.kill();
					panel.webview.postMessage({ command: 'streamingStopped' });
				}
			});
		}
	);

	context.subscriptions.push(showHilogViewerDisposable);
}

// Add log line parser
function parseLogLine(line: string): {
	time: string;
	pid: string;
	tid: string;
	level: string;
	tag: string;
	message: string;
} | null {
	// Example: 05-19 22:35:37.818  3687  3712 E C01406/OHOS::RS: QueryEglBufferAge: eglQuerySurface is failed
	const regex = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([EWID])\s+([^:]+):\s*(.*)$/;
	const match = line.match(regex);
	if (!match) return null;
	return {
		time: match[1],
		pid: match[2],
		tid: match[3],
		level: match[4],
		tag: match[5],
		message: match[6]
	};
}

async function startHilogProcess(
	processId: string | undefined,
	severity: string | 1,
	panel: vscode.WebviewPanel
): Promise<import('child_process').ChildProcessWithoutNullStreams | undefined> {
	const spawn = require('child_process').spawn;
	const severityMap: Record<string, string> = {
		'DEBUG': 'DEBUG',
		'INFO': 'INFO',
		'WARN': 'WARN',
		'ERROR': 'ERROR',
		'FATAL': 'FATAL'
	};
	const level = severityMap[severity] || 'INFO';
	// First set the buffer level
	await new Promise<void>((resolve, reject) => {
		const setLevel = spawn(`${getHdcPath()}`, ['shell', 'hilog', '-b', level]);
		setLevel.on('close', () => resolve());
		setLevel.on('error', reject);
	});
	// Then start log process
	let hilogArgs = ['shell', 'hilog'];
	if (processId && processId.trim() !== '') {
		hilogArgs.push('-P', processId);
	}
	const hdcProcess = spawn(`${getHdcPath()}`, hilogArgs);
	if (hdcProcess) {
		hdcProcess.stdout.on('data', (data: Buffer) => {
			const lines = data.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				const parsed = parseLogLine(line);
				if (parsed) {
					panel.webview.postMessage({ command: 'log', log: parsed });
				} else {
					// Log error to oniroLogChannel instead of webview
					oniroLogChannel.appendLine(`[HiLog parse error] ${line}`);
				}
			}
		});
		hdcProcess.stderr.on('data', (data: Buffer) => {
			// Log error to oniroLogChannel instead of webview
			oniroLogChannel.appendLine(`[HiLog stderr] ${data.toString()}`);
		});
	}
	return hdcProcess;
}

function getHilogWebviewContent(context: vscode.ExtensionContext): string {
	const htmlPath = path.join(context.extensionPath, 'src', 'hilogWebview.html');
	try {
		let html = fs.readFileSync(htmlPath, 'utf8');
		return html;
	} catch (err) {
		return `<html><body><h2>Failed to load HiLog Viewer UI</h2><pre>${err}</pre></body></html>`;
	}
}
