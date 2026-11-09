/**
 * Vendored from easyeda/pro-api-sdk (Apache-2.0), adapted for pcb-pilot.
 * Source: https://github.com/easyeda/pro-api-sdk/blob/main/build/packaged.ts
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { fixUuid, packageExtension, testUuid } from './utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '../');
const extensionConfig = fs.readJSONSync(path.join(rootDir, 'extension.json')) as { name?: string; version?: string; uuid?: string };

function main() {
	if (!testUuid(extensionConfig.uuid)) {
		const newExtensionConfig = { ...extensionConfig, uuid: fixUuid(extensionConfig.uuid) };
		fs.writeJsonSync(path.join(rootDir, 'extension.json'), newExtensionConfig, { spaces: '\t', EOL: '\n', encoding: 'utf-8' });
	}
	const extensionName = extensionConfig.name ?? 'extension';
	const extensionVersion = extensionConfig.version ?? '1.0.0';
	const outputPath = path.join(__dirname, 'dist', `${extensionName}_v${extensionVersion}.eext`);
	fs.ensureDirSync(path.dirname(outputPath));
	packageExtension(rootDir, outputPath).then(() => {
		console.log(`Packaging complete: ${outputPath}`);
	}).catch((err) => {
		console.error('Packaging failed:', err);
		process.exit(1);
	});
}

main();