import * as assert from 'assert';
import * as vscode from 'vscode';
import type { BuildDiagnostic, CrashVerdict, DoctorReport } from '@oniroproject/core';
import { parseHypiumFile, stackLocation } from '../../testing';
import { toVscodeDiagnostic } from '../../diagnostics';
import { renderCrashReport } from '../../appCommands';
import { renderDoctorReport } from '../../doctor';
import { lineAfterImports } from '../../knowledge';
import { codeBlock, escapeMd } from '../../report';

suite('parseHypiumFile', () => {
	test('finds suites and their cases, ignoring comments', () => {
		const text = [
			"import { describe, it, expect } from '@ohos/hypium';",
			'export default function abilityTest() {',
			"  describe('ActsAbilityTest', () => {",
			"    // it('commentedOut', 0, () => {})",
			'    beforeAll(() => {',
			'    })',
			"    it('assertContain', 0, () => {",
			"      let a = 'abc';",
			'    })',
			'    /* it(\'blockComment\', 0, () => {}) */',
			"    it(\"second\", 0, async () => {})",
			'  })',
			"  describe(`Other`, () => {",
			"    it('third', 0, () => {})",
			'  })',
			'}',
		].join('\n');
		assert.deepStrictEqual(parseHypiumFile(text), [
			{ suite: 'ActsAbilityTest', line: 2 },
			{ suite: 'ActsAbilityTest', name: 'assertContain', line: 6 },
			{ suite: 'ActsAbilityTest', name: 'second', line: 10 },
			{ suite: 'Other', line: 12 },
			{ suite: 'Other', name: 'third', line: 13 },
		]);
	});

	test('an it after its describe closed is not attributed to it', () => {
		const text = "describe('A', () => {\n  it('a1', 0, () => {})\n})\nit('orphan', 0, () => {})\n";
		assert.deepStrictEqual(parseHypiumFile(text), [
			{ suite: 'A', line: 0 },
			{ suite: 'A', name: 'a1', line: 1 },
		]);
	});

	test('nested describes report the innermost suite', () => {
		const text = "describe('Outer', () => {\n  describe('Inner', () => {\n    it('x', 0, () => {})\n  })\n  it('y', 0, () => {})\n})";
		const cases = parseHypiumFile(text).filter((t) => t.name);
		assert.deepStrictEqual(cases.map((c) => `${c.suite}#${c.name}`), ['Inner#x', 'Outer#y']);
	});
});

suite('parseHypiumFile strings', () => {
	test('// and braces inside string literals do not shift suites', () => {
		const src = [
			"describe('Net', () => {",
			"  it('fetches', 0, () => {",
			"    fetch('http://x/{').then(() => { const s = \"}\"; });",
			"  });",
			"  it('second', 0, () => {",
			"    const t = `multi",
			"    line } { //`;",
			"  });",
			"});",
		].join('\n');
		assert.deepStrictEqual(parseHypiumFile(src).map((t) => [t.suite, t.name ?? null, t.line]), [
			['Net', null, 0],
			['Net', 'fetches', 1],
			['Net', 'second', 4],
		]);
	});
});

suite('lineAfterImports', () => {
	test('goes after a multi-line import, not inside it', () => {
		const src = "import {\n  AbilityConstant,\n  UIAbility\n} from '@kit.AbilityKit';\nimport hilog from '@ohos.hilog';\n\nexport default class A {}\n";
		assert.strictEqual(lineAfterImports(src), 5);
	});
	test('is 0 with no imports, and handles side-effect imports', () => {
		assert.strictEqual(lineAfterImports('@Entry\nstruct Index {}\n'), 0);
		assert.strictEqual(lineAfterImports("import './polyfill'\n\nconst a = 1;\n"), 1);
	});
});

suite('stackLocation', () => {
	test('reads the first test-file frame of a Hypium stack', () => {
		const stack = 'Error: expect 0 equals 3\n    at anonymous (entry/src/ohosTest/ets/test/Ability.test.ets:35:7)\n    at run (hypium.js:1:1)';
		assert.deepStrictEqual(stackLocation(stack), { file: 'entry/src/ohosTest/ets/test/Ability.test.ets', line: 35, column: 7 });
		assert.strictEqual(stackLocation('no frames'), undefined);
		assert.strictEqual(stackLocation(undefined), undefined);
	});
});

suite('toVscodeDiagnostic', () => {
	test('maps severity, position, source and rule', () => {
		const d: BuildDiagnostic = {
			severity: 'error', source: 'arkts', code: '10605008', rule: 'arkts-no-any-unknown',
			message: 'Use explicit types', file: 'entry/src/main/ets/pages/Index.ets', line: 12, column: 5,
		};
		const v = toVscodeDiagnostic(d);
		assert.strictEqual(v.severity, vscode.DiagnosticSeverity.Error);
		assert.strictEqual(v.range.start.line, 11);
		assert.strictEqual(v.range.start.character, 4);
		assert.strictEqual(v.code, 'arkts-no-any-unknown');
		assert.strictEqual(v.source, 'oniro arkts');
	});

	test('a file-less diagnostic names its task and sits on line 1', () => {
		const v = toVscodeDiagnostic({ severity: 'warning', source: 'hvigor', message: 'Something', task: ':entry:default@SignHap' });
		assert.strictEqual(v.severity, vscode.DiagnosticSeverity.Warning);
		assert.strictEqual(v.range.start.line, 0);
		assert.ok(v.message.includes(':entry:default@SignHap'));
	});
});

suite('reports', () => {
	test('escapeMd and codeBlock keep user text inert', () => {
		assert.strictEqual(escapeMd('a_b*c[d]'), 'a\\_b\\*c\\[d\\]');
		const block = codeBlock('has ``` inside');
		assert.ok(block.startsWith('````\n'));
		assert.ok(block.endsWith('\n````'));
	});

	test('renderCrashReport names the kind, reason and error', () => {
		const v = {
			crashed: true, kind: 'js_crash', subtype: null, confidence: 'high', completeness: 'complete',
			bundle: 'org.example.app', process: 'org.example.app', pid: 123, uid: 20010043, tid: 123, threadName: 'org.example.app',
			time: '2026-11-05 12:32:57.298', reason: 'TypeError', topFrame: 'at onClick entry (entry/src/main/ets/pages/Index.ets:20:9)',
			projectFrame: null, file: 'entry/src/main/ets/pages/Index.ets', line: 20, column: 9,
			jsError: { name: 'TypeError', message: 'Cannot read property x of undefined', stack: ['at onClick (Index.ets:20:9)'] },
			stack: [], nativeFrames: [], jsFrames: [], binderChain: [], deadlocks: [], notes: [], lastFatalMessage: null,
			gwpAsan: null, evidence: [], name: 'jscrash-org.example.app.log', path: '/data/log/faultlog/faultlogger/jscrash.log', rawPath: null,
		} as unknown as CrashVerdict;
		const md = renderCrashReport(v, '/nonexistent');
		assert.ok(md.startsWith('# JS crash: org.example.app'));
		assert.ok(md.includes('Cannot read property x of undefined'));
		assert.ok(md.includes('entry/src/main/ets/pages/Index.ets'));
		assert.ok(md.includes('/data/log/faultlog/faultlogger/jscrash.log'));
	});

	test('renderDoctorReport tabulates the checks', () => {
		const r: DoctorReport = {
			ok: false,
			checks: [
				{ id: 'java', status: 'fail', detail: 'java not found', fix: 'Install a JDK' },
				{ id: 'node', status: 'ok', detail: 'v24' },
			],
			versions: { node: 'v24' },
		};
		const md = renderDoctorReport(r);
		assert.ok(md.includes('problems found'));
		assert.ok(md.includes('| ❌ | Java (signing) | java not found | Install a JDK |'));
		assert.ok(md.includes('**Node.js:** v24'));
	});
});
