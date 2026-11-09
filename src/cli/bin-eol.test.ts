import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const binPath = join(repoRoot, 'dist', 'cli', 'main.js');
const BIN_SHEBANG = '#!/usr/bin/env node';

function firstLine(file: string): string {
	return readFileSync(file, 'utf8').split('\n')[0];
}

it('CLI 源码首行是干净的 shebang（无 CR）', () => {
	const line = firstLine(join(repoRoot, 'src', 'cli', 'main.ts'));
	expect(line.startsWith(BIN_SHEBANG)).toBe(true);
	expect(line.includes('\r')).toBe(false);
});

it.runIf(existsSync(binPath))('构建产物 bin 的 shebang 无 CR（Linux/macOS 上 CRLF 会导致 bad interpreter）', () => {
	const line = firstLine(binPath);
	expect(line.startsWith(BIN_SHEBANG)).toBe(true);
	expect(line.includes('\r')).toBe(false);
});
