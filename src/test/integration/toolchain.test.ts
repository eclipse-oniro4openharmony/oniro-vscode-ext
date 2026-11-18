import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    DocsIndex,
    docsTree,
    getBundleName,
    isUsableDevice,
    latestCrash,
    listDevices,
    searchApi,
    takeScreenshot,
    uninstallApp,
} from '@oniroproject/core';
import { vscodeConfigProvider } from '../../adapters';
import { installProjectApp, launchProjectApp, renderCrashReport } from '../../appCommands';
import { runArktsCheck } from '../../arktsCheck';
import { BuildError, runBuild } from '../../build';
import { OniroDiagnostics } from '../../diagnostics';
import { runDoctorCheck } from '../../doctor';
import { startEmulatorAndWait } from '../../emulator';
import { openApiIndex, selectDocs } from '../../knowledge';
import { languageClient } from '../../languageClient';
import { signProject } from '../../signing';
import { OhosTestController } from '../../testing';
import { hasSigningConfigs } from '../../utils/project';

const EXTENSION_ID = 'oniro.oniro-app-ide';

/**
 * End-to-end checks of the extension against the real toolchain. They need the
 * fixture project (scripts/create-fixture.cjs), its SDK, the command-line tools,
 * java, and a connected device or the Oniro emulator. Device steps are skipped
 * when no device is connected.
 */
suite('toolchain (integration)', () => {
    const projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const indexEts = path.join(projectDir, 'entry/src/main/ets/pages/Index.ets');
    let original = '';
    let haveDevice = false;

    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
        original = fs.readFileSync(indexEts, 'utf8');
        // Pin one target so hdc is never ambiguous, preferring the emulator so a
        // physical device that happens to be plugged in is left alone.
        const usable = (await listDevices(vscodeConfigProvider)).filter(isUsableDevice);
        const target = usable.find((d) => d.serial.startsWith('127.0.0.1:')) ?? usable[0];
        haveDevice = !!target;
        if (target) { process.env.ONIRO_DEVICE_SERIAL = target.serial; }
    });

    suiteTeardown(async () => {
        fs.writeFileSync(indexEts, original);
        if (haveDevice) {
            await uninstallApp({ config: vscodeConfigProvider, bundle: getBundleName(projectDir) }).catch(() => undefined);
        }
    });

    test('the project is recognised', async () => {
        assert.ok(fs.existsSync(path.join(projectDir, 'build-profile.json5')));
    });

    test('the ArkTS language server starts', async function () {
        const client = languageClient();
        assert.ok(client, 'no language client');
        const deadline = Date.now() + 30000;
        while (!client.isRunning() && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 500));
        }
        assert.ok(client.isRunning(), 'language client is not running');
    });

    test('oniro tasks are provided', async () => {
        const tasks = await vscode.tasks.fetchTasks({ type: 'oniro' });
        assert.deepStrictEqual(tasks.map((t) => t.name).sort(), ['build', 'check ArkTS']);
    });

    test('sign writes OpenHarmony signing configs', async () => {
        assert.ok(await signProject(projectDir));
        assert.ok(hasSigningConfigs(projectDir));
    });

    test('check ArkTS passes on the template and reports an injected error', async () => {
        const clean = await runArktsCheck({ projectDir, quiet: true });
        assert.ok(clean?.completed, clean?.error);
        assert.strictEqual(clean.summary.errors, 0, JSON.stringify(clean.diagnostics));

        fs.writeFileSync(indexEts, original.replace('build() {', 'build() {\n    let broken: any = 1;'));
        const rel = path.relative(projectDir, indexEts);
        const bad = await runArktsCheck({ projectDir, files: [rel], quiet: true });
        assert.ok(bad?.completed, bad?.error);
        assert.ok(bad.summary.errors > 0, 'no error reported for `any`');
        const problems = vscode.languages.getDiagnostics(vscode.Uri.file(indexEts));
        assert.ok(problems.some((d) => d.source === 'oniro arkts-check' && d.severity === vscode.DiagnosticSeverity.Error), JSON.stringify(problems));
        fs.writeFileSync(indexEts, original);
        await runArktsCheck({ projectDir, files: [rel], quiet: true });
        assert.strictEqual(vscode.languages.getDiagnostics(vscode.Uri.file(indexEts)).filter((d) => d.source === 'oniro arkts-check').length, 0);
    });

    test('a failing build puts its errors in the Problems panel', async () => {
        fs.writeFileSync(indexEts, original.replace('build() {', 'build() {\n    let n: number = "not a number";'));
        try {
            await assert.rejects(runBuild({ projectDir }), (err: unknown) => {
                assert.ok(err instanceof BuildError, String(err));
                assert.ok(err.report.diagnostics.some((d) => d.severity === 'error' && d.file?.endsWith('Index.ets')), JSON.stringify(err.report.diagnostics));
                return true;
            });
            const problems = vscode.languages.getDiagnostics(vscode.Uri.file(indexEts));
            assert.ok(problems.some((d) => d.source?.startsWith('oniro') && d.severity === vscode.DiagnosticSeverity.Error), JSON.stringify(problems));
        } finally {
            fs.writeFileSync(indexEts, original);
        }
    });

    test('the build passes, produces a signed HAP and clears the problems', async () => {
        const report = await runBuild({ projectDir });
        assert.ok(report?.ok, report?.error);
        const haps = Object.values(report.discoveredHaps).flatMap((m) => m.signed);
        assert.ok(haps.length > 0, 'no signed HAP');
        assert.strictEqual(vscode.languages.getDiagnostics(vscode.Uri.file(indexEts)).filter((d) => d.source?.startsWith('oniro ') && d.source !== 'oniro arkts-check').length, 0);
    });

    test('the emulator wait returns on a running, booted emulator', async function () {
        if (!haveDevice) { this.skip(); }
        const started = Date.now();
        await startEmulatorAndWait({ report: () => undefined });
        assert.ok(Date.now() - started < 60000);
    });

    test('install, launch, screenshot and crash lookup on the device', async function () {
        if (!haveDevice) { this.skip(); }
        const installed = await installProjectApp(projectDir);
        assert.ok(installed?.installed);
        assert.strictEqual(installed.bundleName, 'org.oniroproject.extfixture');

        const launchedAt = new Date(Date.now() - 2000);
        const pid = await launchProjectApp(projectDir);
        assert.ok(pid && /^\d+$/.test(pid), `pid: ${pid}`);

        const shot = await takeScreenshot({ config: vscodeConfigProvider });
        assert.ok(shot.pixels.length > 1000);
        assert.strictEqual(shot.pixels.subarray(0, 2).toString('hex'), 'ffd8', 'not a JPEG');

        const crash = await latestCrash({ config: vscodeConfigProvider, bundle: installed.bundleName, since: launchedAt });
        assert.strictEqual(crash, null, `unexpected crash: ${crash?.reason}`);
    });

    test('a JS crash is found and points at the project source', async function () {
        if (!haveDevice) { this.skip(); }
        fs.writeFileSync(indexEts, original.replace('  build() {', "  aboutToAppear(): void {\n    throw new Error('oniro-ext crash test');\n  }\n\n  build() {"));
        try {
            const report = await runBuild({ projectDir });
            assert.ok(report?.ok, report?.error);
            const installed = await installProjectApp(projectDir);
            assert.ok(installed?.installed);
            const launchedAt = new Date(Date.now() - 5000);
            await launchProjectApp(projectDir).catch(() => undefined);
            const crash = await latestCrash({ config: vscodeConfigProvider, bundle: installed.bundleName, since: launchedAt, waitMs: 20000 });
            assert.ok(crash, 'no crash found');
            assert.strictEqual(crash.kind, 'js_crash');
            assert.ok(crash.jsError?.message.includes('oniro-ext crash test'), JSON.stringify(crash.jsError));
            assert.ok(crash.file?.endsWith('pages/Index.ets'), `file: ${crash.file}`);
            const md = renderCrashReport(crash, projectDir);
            assert.ok(md.includes('#L'), 'no source link in the report');
        } finally {
            fs.writeFileSync(indexEts, original);
            await runBuild({ projectDir });
            await installProjectApp(projectDir);
        }
    });

    test('ohosTest suites are discovered and run through the Test controller', async function () {
        if (!haveDevice) { this.skip(); }
        const diags = new OniroDiagnostics();
        const ctl = new OhosTestController({ effectiveSerial: process.env.ONIRO_DEVICE_SERIAL }, diags, 'oniro-ohostest-it');
        try {
            ctl.discover();
            const mod = ctl.controller.items.get('module:entry');
            assert.ok(mod, 'entry module not discovered');
            const suite = mod.children.get('entry/ActsAbilityTest');
            assert.ok(suite?.children.get('entry/ActsAbilityTest#assertContain'), 'case not discovered');

            const outcomes: Record<string, string> = {};
            const realCreate = ctl.controller.createTestRun.bind(ctl.controller);
            ctl.controller.createTestRun = (req, name, persist) => {
                const run = realCreate(req, name, persist);
                const record = (state: string) => (item: vscode.TestItem) => { outcomes[item.id] = state; };
                return new Proxy(run, {
                    get(target, prop, recv) {
                        const orig = Reflect.get(target, prop, recv);
                        if (['passed', 'failed', 'errored', 'skipped'].includes(String(prop))) {
                            const rec = record(String(prop));
                            return (item: vscode.TestItem, ...rest: unknown[]) => { rec(item); return orig.call(target, item, ...rest); };
                        }
                        return typeof orig === 'function' ? orig.bind(target) : orig;
                    },
                });
            };
            const cts = new vscode.CancellationTokenSource();
            await ctl.run(new vscode.TestRunRequest([suite!]), cts.token);
            assert.strictEqual(outcomes['entry/ActsAbilityTest#assertContain'], 'passed', JSON.stringify(outcomes));
        } finally {
            ctl.dispose();
            diags.dispose();
        }
    });

    test('doctor reports on the toolchain', async () => {
        const report = await runDoctorCheck({ show: false });
        assert.ok(report);
        const ids = report.checks.map((c) => c.id);
        for (const id of ['node', 'java', 'sdk', 'cmdtools']) {
            assert.ok(ids.includes(id), `doctor check ${id} missing`);
        }
        assert.strictEqual(report.checks.find((c) => c.id === 'sdk')?.status, 'ok');
    });

    test('the SDK API index finds known symbols', async () => {
        const index = await openApiIndex();
        assert.ok(index.entries.length > 1000);
        const hit = searchApi(index, 'NavPathStack pushPathByName', { limit: 5 }).hits[0];
        assert.ok(hit, 'no hit');
        assert.strictEqual(hit.qualifiedName, 'NavPathStack.pushPathByName');
        const router = searchApi(index, 'router.pushUrl', { limit: 3 }).hits[0];
        assert.ok(router?.import?.includes('@kit.ArkUI'), router?.import);
    });

    test('the synced docs are searchable', async function () {
        const tree = docsTree(selectDocs().dir);
        if (!tree) { this.skip(); }
        const hits = DocsIndex.load(tree).search('NavPathStack', { limit: 5 }).hits;
        assert.ok(hits.length > 0);
        assert.ok(fs.existsSync(path.join(tree, hits[0].path)));
    });

    test('the HiLog viewer opens and is reused', async () => {
        await vscode.commands.executeCommand('oniro-ide.showHilogViewer');
        await vscode.commands.executeCommand('oniro-ide.showHilogViewer', { processId: '1', severity: 'INFO' });
        await new Promise((r) => setTimeout(r, 1000));
        const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)
            .filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('oniroHilogViewer'));
        assert.strictEqual(tabs.length, 1);
        await vscode.window.tabGroups.close(tabs);
    });
});
