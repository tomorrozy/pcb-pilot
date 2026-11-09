import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DaemonPaths } from './paths.js';

// 目录里同时放着 token、审计日志与制造文件，宽松 umask 建出的 0755 目录会让同机其他用户可读，故每次收紧
export function loadOrCreateToken(paths: DaemonPaths): string {
	mkdirSync(paths.homeDir, { recursive: true });
	try {
		chmodSync(paths.homeDir, 0o700);
	}
	catch {}
	if (existsSync(paths.tokenFile)) {
		const token = readFileSync(paths.tokenFile, 'utf8').trim();
		// writeFileSync 的 mode 只在建文件时生效，已有文件（可能是从别处复制来的）要显式收紧
		try {
			chmodSync(paths.tokenFile, 0o600);
		}
		catch {}
		return token;
	}
	const token = randomBytes(32).toString('hex');
	writeFileSync(paths.tokenFile, `${token}\n`, { mode: 0o600 });
	return token;
}
