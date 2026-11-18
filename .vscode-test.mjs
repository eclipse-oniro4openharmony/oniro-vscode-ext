import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		// Pure logic and activation; needs no SDK or device.
		label: 'unit',
		files: 'out/test/unit/**/*.test.js',
		mocha: { timeout: 20000 },
	},
	{
		// Against the real toolchain: a scaffolded project (scripts/create-fixture.cjs),
		// the installed SDK and command-line tools, and a connected device or emulator.
		label: 'integration',
		files: 'out/test/integration/**/*.test.js',
		workspaceFolder: '.vscode-test/fixtures/OniroExtFixture',
		mocha: { timeout: 600000 },
	},
	{
		// Screenshots of the UI for a human to review: xvfb-run -a npx vscode-test --label visual
		label: 'visual',
		files: 'out/test/visual/**/*.test.js',
		workspaceFolder: '.vscode-test/fixtures/OniroExtFixture',
		mocha: { timeout: 120000 },
		launchArgs: ['--disable-workspace-trust', '--disable-gpu', '--ozone-platform=x11'],
	},
]);
