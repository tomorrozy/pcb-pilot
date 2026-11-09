import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
if (!existsSync(file)) {
	console.error(`${file} 不存在 —— 先运行 npm run build 再校验 bin`);
	process.exit(1);
}
const text = readFileSync(file, 'utf8');
const firstLine = text.split('\n')[0];

if (!firstLine.startsWith('#!/usr/bin/env node')) {
	console.error(`bin shebang missing or wrong: ${JSON.stringify(firstLine)}`);
	process.exit(1);
}
if (text.includes('\r')) {
	console.error(`${file} contains CR characters — the shebang breaks on Linux/macOS ("bad interpreter"). Rebuild with LF newlines.`);
	process.exit(1);
}
console.log('bin shebang is LF-clean');
