// Scaffold the project the integration tests open: the bundled EmptyAbility
// template, at the API level in ONIRO_FIXTURE_API (default 23).
const path = require('path');
const fs = require('fs');
const { createScaffold, staticConfig } = require('@oniroproject/core');

const root = path.resolve(__dirname, '..');
const location = path.join(root, '.vscode-test', 'fixtures');
const api = Number(process.env.ONIRO_FIXTURE_API || 23);
fs.mkdirSync(location, { recursive: true });
createScaffold({
	config: staticConfig({}),
	templateId: 'EmptyAbility',
	projectName: 'OniroExtFixture',
	bundleName: 'org.oniroproject.extfixture',
	location,
	sdkApi: api,
	templateRoot: path.join(root, 'template'),
	overwrite: true,
}).then(({ projectDir }) => console.log(`Fixture project: ${projectDir} (API ${api})`), (err) => {
	console.error(err);
	process.exit(1);
});
