import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { type TestCaseResult, runTests } from '@oniroproject/core';
import { tokenToSignal, vscodeConfigProvider, vscodeLogger } from './adapters';
import type { DeviceManager } from './device';
import { OniroDiagnostics, publishDiagnostics } from './diagnostics';
import { errorMessage, loadBuildProfile, tryGetWorkspaceRoot, isOhosProject } from './utils/project';

/** A Hypium `describe` or `it` found in a test file. */
export interface ParsedHypiumTest {
    suite: string;
    /** Undefined for the suite itself. */
    name?: string;
    /** 0-based line of the call. */
    line: number;
}

const CALL_RE = /\b(describe|it)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g;

/**
 * Find Hypium suites and cases in a test file. Pure. Each `it` belongs to the
 * nearest `describe` that encloses it, judged by brace depth, which is what the
 * runner reports as `class`.
 */
export function parseHypiumFile(text: string): ParsedHypiumTest[] {
    const out: ParsedHypiumTest[] = [];
    // Depth at which each open describe's body starts.
    const stack: Array<{ suite: string; depth: number }> = [];
    let depth = 0;
    let i = 0;
    let line = 0;
    CALL_RE.lastIndex = 0;
    let next = CALL_RE.exec(text);
    while (i < text.length) {
        if (next && next.index === i) {
            while (stack.length && depth < stack[stack.length - 1].depth) { stack.pop(); }
            const [, fn, , label] = next;
            if (fn === 'describe') {
                out.push({ suite: label, line });
                // Its body opens at the next `{`, one level deeper than here.
                stack.push({ suite: label, depth: depth + 1 });
            } else if (stack.length) {
                out.push({ suite: stack[stack.length - 1].suite, name: label, line });
            }
            for (const ch of next[0]) { if (ch === '\n') { line++; } }
            i += next[0].length;
            next = CALL_RE.exec(text);
            continue;
        }
        if (next && next.index < i) {
            CALL_RE.lastIndex = i;
            next = CALL_RE.exec(text);
            continue;
        }
        const ch = text[i];
        if (ch === "'" || ch === '"' || ch === '`') {
            // Skip the literal, so `//` and braces inside it count for nothing.
            // (A template's `${}` expressions are skipped along with it.)
            let j = i + 1;
            while (j < text.length && text[j] !== ch) {
                if (text[j] === '\\') { j++; }
                else if (text[j] === '\n') {
                    if (ch !== '`') { break; }
                    line++;
                }
                j++;
            }
            i = j + 1;
            continue;
        }
        if (ch === '/' && text[i + 1] === '/') {
            const end = text.indexOf('\n', i);
            i = end === -1 ? text.length : end;
            continue;
        }
        if (ch === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? text.length : end + 2;
            for (let j = i; j < stop; j++) { if (text[j] === '\n') { line++; } }
            i = stop;
            continue;
        }
        if (ch === '{') { depth++; }
        else if (ch === '}') {
            depth--;
            while (stack.length && depth < stack[stack.length - 1].depth) { stack.pop(); }
        } else if (ch === '\n') { line++; }
        i++;
    }
    return out;
}

/** `file:line:col` of the first frame in a test file, from a Hypium stack. */
export function stackLocation(stack: string | undefined): { file: string; line: number; column: number } | undefined {
    if (!stack) { return undefined; }
    const m = /([\w./-]*src\/ohosTest\/[\w./-]+\.ets):(\d+):(\d+)/.exec(stack);
    return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]) } : undefined;
}

interface ModuleInfo {
    name: string;
    dir: string;
}

function testModules(projectDir: string): ModuleInfo[] {
    let modules: ModuleInfo[] = [];
    try {
        modules = (loadBuildProfile(projectDir).modules ?? []).map((m) => ({
            name: m.name,
            dir: path.resolve(projectDir, m.srcPath ?? m.name),
        }));
    } catch {
        return [];
    }
    return modules.filter((m) => fs.existsSync(path.join(m.dir, 'src', 'ohosTest')));
}

function listTestFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); }
            else if (e.name.endsWith('.ets')) { out.push(p); }
        }
    };
    const root = path.join(dir, 'src', 'ohosTest', 'ets');
    if (fs.existsSync(root)) { walk(root); }
    return out.sort();
}

/**
 * ohosTest suites in the Test Explorer. Suites and cases are read from the test
 * sources; a run builds the main and test HAPs, installs both and runs the selected
 * suites with `aa test` on the target device through core's `runTests`.
 */
export class OhosTestController implements vscode.Disposable {
    private readonly ctrl: vscode.TestController;
    private readonly disposables: vscode.Disposable[];
    private readonly moduleOf = new WeakMap<vscode.TestItem, string>();

    constructor(
        private readonly devices: Pick<DeviceManager, 'effectiveSerial'>,
        private readonly diagnostics: OniroDiagnostics,
        id = 'oniro-ohostest',
    ) {
        this.ctrl = vscode.tests.createTestController(id, 'OpenHarmony Tests');
        this.disposables = [this.ctrl];
        this.ctrl.resolveHandler = async () => this.discover();
        this.ctrl.refreshHandler = async () => this.discover();
        this.ctrl.createRunProfile('Run on Device', vscode.TestRunProfileKind.Run, (req, token) => this.run(req, token), true);

        const watcher = vscode.workspace.createFileSystemWatcher('**/src/ohosTest/**/*.ets');
        const rediscover = () => this.discover();
        watcher.onDidChange(rediscover);
        watcher.onDidCreate(rediscover);
        watcher.onDidDelete(rediscover);
        this.disposables.push(watcher);
    }

    dispose(): void {
        for (const d of this.disposables) { d.dispose(); }
    }

    discover(): void {
        const projectDir = tryGetWorkspaceRoot();
        if (!isOhosProject(projectDir)) {
            this.ctrl.items.replace([]);
            return;
        }
        const roots: vscode.TestItem[] = [];
        for (const mod of testModules(projectDir)) {
            const modItem = this.ctrl.createTestItem(`module:${mod.name}`, mod.name, vscode.Uri.file(path.join(mod.dir, 'src', 'ohosTest')));
            this.moduleOf.set(modItem, mod.name);
            for (const file of listTestFiles(mod.dir)) {
                let parsed: ParsedHypiumTest[];
                try {
                    parsed = parseHypiumFile(fs.readFileSync(file, 'utf8'));
                } catch {
                    continue;
                }
                const uri = vscode.Uri.file(file);
                for (const t of parsed) {
                    const suiteId = `${mod.name}/${t.suite}`;
                    let suite = modItem.children.get(suiteId);
                    if (!suite) {
                        suite = this.ctrl.createTestItem(suiteId, t.suite, uri);
                        suite.range = new vscode.Range(t.line, 0, t.line, 0);
                        this.moduleOf.set(suite, mod.name);
                        modItem.children.add(suite);
                    }
                    if (t.name) {
                        const item = this.ctrl.createTestItem(`${suiteId}#${t.name}`, t.name, uri);
                        item.range = new vscode.Range(t.line, 0, t.line, 0);
                        this.moduleOf.set(item, mod.name);
                        suite.children.add(item);
                    }
                }
            }
            roots.push(modItem);
        }
        this.ctrl.items.replace(roots);
    }

    /** The runner's `class` filter for an item: `Suite` or `Suite#case`; undefined for a whole module. */
    private classFilter(item: vscode.TestItem): string | undefined {
        if (item.id.startsWith('module:')) { return undefined; }
        return item.id.slice(item.id.indexOf('/') + 1);
    }

    private leaves(item: vscode.TestItem, out: vscode.TestItem[] = []): vscode.TestItem[] {
        if (item.children.size === 0) {
            out.push(item);
        } else {
            item.children.forEach((c) => this.leaves(c, out));
        }
        return out;
    }

    /** @internal exposed for the integration tests. */
    get controller(): vscode.TestController {
        return this.ctrl;
    }

    async run(req: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        const projectDir = tryGetWorkspaceRoot();
        const run = this.ctrl.createTestRun(req);
        if (!isOhosProject(projectDir)) {
            run.end();
            return;
        }
        if (this.ctrl.items.size === 0) { this.discover(); }

        // Group the requested items by module: one `aa test` per module.
        const requested: vscode.TestItem[] = [];
        if (req.include) { requested.push(...req.include); } else { this.ctrl.items.forEach((i) => requested.push(i)); }
        const excluded = new Set((req.exclude ?? []).map((i) => i.id));
        const byModule = new Map<string, { filters: Set<string> | null; items: vscode.TestItem[] }>();
        for (const item of requested) {
            if (excluded.has(item.id)) { continue; }
            const mod = this.moduleOf.get(item);
            if (!mod) { continue; }
            const entry = byModule.get(mod) ?? { filters: new Set<string>(), items: [] };
            const filter = this.classFilter(item);
            if (filter === undefined) { entry.filters = null; } else if (entry.filters) { entry.filters.add(filter); }
            entry.items.push(...this.leaves(item).filter((l) => !excluded.has(l.id)));
            byModule.set(mod, entry);
        }

        for (const [mod, { filters, items }] of byModule) {
            if (token.isCancellationRequested) { break; }
            for (const i of items) { run.enqueued(i); }
            items.forEach((i) => run.started(i));
            const bridge = tokenToSignal(token);
            try {
                const report = await runTests({
                    config: vscodeConfigProvider,
                    projectDir,
                    module: mod,
                    testClass: filters ? [...filters].join(',') : undefined,
                    deviceSerial: this.devices.effectiveSerial,
                    abortSignal: bridge.signal,
                    logger: vscodeLogger,
                    onOutput: (chunk) => run.appendOutput(chunk.replace(/\r?\n/g, '\r\n')),
                });
                if (report.diagnostics?.length) {
                    publishDiagnostics(this.diagnostics.build, projectDir, report.diagnostics);
                }
                const seen = new Set<string>();
                for (const r of report.tests) {
                    const item = this.findCase(mod, r) ?? this.addCase(mod, r);
                    seen.add(item.id);
                    this.report(run, item, r, projectDir);
                }
                const why = report.error ?? (report.warnings.length ? report.warnings.join('\n') : undefined);
                for (const i of items) {
                    if (seen.has(i.id)) { continue; }
                    if (report.outcome === 'runner-error') {
                        run.errored(i, new vscode.TestMessage(why ?? 'The test run did not complete.'));
                    } else {
                        run.skipped(i);
                    }
                }
                run.appendOutput(`\r\n${report.summary.run} run, ${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.error} errored, ${report.summary.ignore} ignored (${(report.durationMs / 1000).toFixed(1)} s)\r\n`);
                if (report.log.length) {
                    run.appendOutput(`\r\n--- app log during the run ---\r\n${report.log.join('\r\n')}\r\n`);
                }
            } catch (err) {
                for (const i of items) { run.errored(i, new vscode.TestMessage(errorMessage(err))); }
            } finally {
                bridge.dispose();
            }
        }
        run.end();
    }

    private findCase(mod: string, r: TestCaseResult): vscode.TestItem | undefined {
        return this.ctrl.items.get(`module:${mod}`)?.children.get(`${mod}/${r.suite}`)?.children.get(`${mod}/${r.suite}#${r.name}`);
    }

    /** A case the runner reported but the sources did not show (generated names, say). */
    private addCase(mod: string, r: TestCaseResult): vscode.TestItem {
        let modItem = this.ctrl.items.get(`module:${mod}`);
        if (!modItem) {
            modItem = this.ctrl.createTestItem(`module:${mod}`, mod);
            this.moduleOf.set(modItem, mod);
            this.ctrl.items.add(modItem);
        }
        let suite = modItem.children.get(`${mod}/${r.suite}`);
        if (!suite) {
            suite = this.ctrl.createTestItem(`${mod}/${r.suite}`, r.suite);
            this.moduleOf.set(suite, mod);
            modItem.children.add(suite);
        }
        const item = this.ctrl.createTestItem(`${mod}/${r.suite}#${r.name}`, r.name);
        this.moduleOf.set(item, mod);
        suite.children.add(item);
        return item;
    }

    private report(run: vscode.TestRun, item: vscode.TestItem, r: TestCaseResult, projectDir: string): void {
        if (r.status === 'pass') {
            run.passed(item, r.durationMs);
            return;
        }
        if (r.status === 'ignore') {
            run.skipped(item);
            return;
        }
        const msg = new vscode.TestMessage(r.message ?? (r.status === 'error' ? 'The case threw.' : 'The case failed.'));
        const loc = stackLocation(r.stack);
        if (loc) {
            const abs = path.isAbsolute(loc.file) ? loc.file : path.join(projectDir, loc.file);
            if (fs.existsSync(abs)) {
                msg.location = new vscode.Location(vscode.Uri.file(abs), new vscode.Position(loc.line - 1, Math.max(0, loc.column - 1)));
            }
        }
        if (!msg.location && item.uri && item.range) {
            msg.location = new vscode.Location(item.uri, item.range);
        }
        if (r.stack) {
            msg.message = `${msg.message}\n\n${r.stack}`;
        }
        if (r.status === 'error') {
            run.errored(item, msg, r.durationMs);
        } else {
            run.failed(item, msg, r.durationMs);
        }
    }
}
