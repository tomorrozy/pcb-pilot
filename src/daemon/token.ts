import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DaemonPaths } from './paths.js';
import { restrictToOwner } from './permissions.js';

export function loadOrCreateToken(paths: DaemonPaths): string {
	const existed = existsSync(paths.homeDir);
	mkdirSync(paths.homeDir, { recursive: true });
	// 只收紧本次创建的目录；PCBP_HOME 可能指向用户自选的位置，越权改既有目录权限不是 daemon 的职责
	if (!existed) {
		try {
			chmodSync(paths.homeDir, 0o700);
		}
		catch {}
	}
	if (existsSync(paths.tokenFile)) {
		const token = readFileSync(paths.tokenFile, 'utf8').trim();
		restrictToOwner(paths.tokenFile);
		return token;
	}
	const token = randomBytes(32).toString('hex');
	writeFileSync(paths.tokenFile, `${token}\n`, { mode: 0o600 });
	return token;
}
