import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// Not a test as such: drives the UI and captures the X display (run under xvfb-run)
// into .vscode-test/screens for a human to look at.
const out = path.resolve(__dirname, '../../../.vscode-test/screens');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function shot(name: string) {
	fs.mkdirSync(out, { recursive: true });
	execFileSync('import', ['-window', 'root', path.join(out, `${name}.png`)]);
}

suite('screens', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('oniro.oniro-app-ide')!.activate();
	});
	test('sidebar', async () => {
		await vscode.commands.executeCommand('workbench.view.extension.oniro-sidebar');
		await sleep(6000);
		shot('sidebar');
	});
	test('sdk manager', async () => {
		await vscode.commands.executeCommand('oniro-ide.openSdkManager');
		await sleep(3000);
		shot('sdk-manager');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
	test('doctor', async () => {
		await vscode.commands.executeCommand('oniro-ide.runDoctor');
		await sleep(4000);
		shot('doctor');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
	test('build configurator and create project', async () => {
		await vscode.commands.executeCommand('oniro-ide.build');
		await sleep(2500);
		shot('build-config');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('oniro-ide.createProject');
		await sleep(2500);
		shot('create-project');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
	test('testing view', async () => {
		await vscode.commands.executeCommand('workbench.view.testing.focus');
		await sleep(2500);
		shot('testing');
	});
});
