import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { OniroCommands } from '../../commandIds';

const EXTENSION_ID = 'oniro.oniro-app-ide';

suite('activation', () => {
	suiteSetup(async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(ext, `${EXTENSION_ID} is not loaded`);
		await ext.activate();
	});

	test('every contributed command is registered, and every registered one contributed', async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
		const contributed: string[] = ext.packageJSON.contributes.commands.map((c: { command: string }) => c.command);
		const registered = new Set(await vscode.commands.getCommands(true));
		for (const id of contributed) {
			assert.ok(registered.has(id), `${id} is contributed but not registered`);
		}
		for (const id of Object.values(OniroCommands)) {
			assert.ok(contributed.includes(id), `${id} is registered but not in package.json`);
		}
	});

	test('package.json settings cover the config keys the extension forwards', () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
		const props = Object.keys(ext.packageJSON.contributes.configuration.properties);
		for (const key of ['sdkRootDir', 'cmdToolsPath', 'emulatorDir', 'hapPath', 'tmpDir', 'hdcPath', 'harmonyosSdkPath']) {
			assert.ok(props.includes(`oniro.${key}`), `oniro.${key} missing`);
		}
	});

	test('URL and HAP settings default to empty so core picks the defaults', () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
		const props = ext.packageJSON.contributes.configuration.properties;
		assert.strictEqual(props['oniro.emulatorUrl'].default, '');
		assert.strictEqual(props['oniro.cmdToolsUrlLinux'].default, '');
		assert.strictEqual(props['oniro.hapPath'].default, '');
	});

	test('the bundled templates are all listed and the webviews ship', () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
		const templates = fs.readdirSync(path.join(ext.extensionPath, 'template'));
		for (const t of ['EmptyAbility', 'NativeCpp', 'HarmonyOSApp']) {
			assert.ok(templates.includes(t), `template ${t} missing`);
		}
		for (const html of ['sdkManagerWebview.html', 'hilogWebview.html', 'createProjectWebview.html', 'buildConfigWebview.html']) {
			assert.ok(fs.existsSync(path.join(ext.extensionPath, 'out', html)), `${html} not copied to out/`);
		}
	});
});
