import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DaemonPaths } from './paths.js';

export function loadOrCreateToken(paths: DaemonPaths): string {
	if (existsSync(paths.tokenFile))
		return readFileSync(paths.tokenFile, 'utf8').trim();
	mkdirSync(paths.homeDir, { recursive: true });
	const token = randomBytes(32).toString('hex');
	writeFileSync(paths.tokenFile, `${token}\n`, { mode: 0o600 });
	return token;
}