import { existsSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type EdaClientSource = 'env' | 'dir' | 'path' | 'none';

export interface EdaClientEntry {
	path: string;
	source: Exclude<EdaClientSource, 'none'>;
}

export interface EdaClientLookupOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	home?: string;
	exists?: (p: string) => boolean;
	isDirectory?: (p: string) => boolean;
}

export interface EdaClientLookup {
	found: boolean;
	path?: string;
	source: EdaClientSource;
	candidates: string[];
}

function staticDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Array<string> {
	if (platform === 'win32') {
		const dirs: Array<string> = [];
		if (env.LOCALAPPDATA)
			dirs.push(join(env.LOCALAPPDATA, 'Programs', 'lceda-pro'));
		for (const key of ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'ProgramFiles', 'ProgramFiles (x86)']) {
			if (env[key])
				dirs.push(join(env[key], 'lceda-pro'));
		}
		return dirs;
	}
	if (platform === 'darwin')
		return ['/Applications/LCEDA-Pro.app', join(home, 'Applications', 'LCEDA-Pro.app'), '/Applications/lceda-pro.app', '/Applications/嘉立创EDA专业版.app'];
	return ['/opt/lceda-pro', '/usr/local/lceda-pro', join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'lceda-pro'), join(home, 'lceda-pro'), '/snap/lceda-pro/current'];
}

function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean): Array<string> {
	const names = platform === 'win32' ? ['lceda-pro.exe', 'lceda-pro'] : ['lceda-pro'];
	const dirs: Array<string> = [];
	for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
		if (!dir)
			continue;
		if (names.some(name => exists(join(dir, name))))
			dirs.push(dir);
	}
	return dirs;
}

export function edaClientEntries(opts: EdaClientLookupOptions = {}): Array<EdaClientEntry> {
	const platform = opts.platform ?? process.platform;
	const env = opts.env ?? process.env;
	const home = opts.home ?? homedir();
	const exists = opts.exists ?? existsSync;
	const entries: Array<EdaClientEntry> = [];
	const push = (path: string, source: EdaClientEntry['source']): void => {
		if (path && !entries.some(e => e.path === path))
			entries.push({ path, source });
	};
	if (env.PCBP_EDA_DIR) {
		push(env.PCBP_EDA_DIR, 'env');
		return entries;
	}
	for (const dir of staticDirs(platform, env, home))
		push(dir, 'dir');
	for (const dir of pathDirs(env, platform, exists))
		push(dir, 'path');
	return entries;
}

export function edaClientCandidates(opts: EdaClientLookupOptions = {}): Array<string> {
	return edaClientEntries(opts).map(e => e.path);
}

export function findEdaClient(opts: EdaClientLookupOptions = {}): EdaClientLookup {
	const isDirectory = opts.isDirectory ?? ((p: string) => {
		try {
			return lstatSync(p).isDirectory();
		}
		catch {
			return false;
		}
	});
	const exists = opts.exists ?? existsSync;
	const entries = edaClientEntries(opts);
	for (const entry of entries) {
		if (entry.source === 'path')
			return { found: true, path: entry.path, source: entry.source, candidates: entries.map(e => e.path) };
		if (exists(entry.path) && isDirectory(entry.path))
			return { found: true, path: entry.path, source: entry.source, candidates: entries.map(e => e.path) };
	}
	return { found: false, source: 'none', candidates: entries.map(e => e.path) };
}

export function platformNotes(platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32')
		return 'Windows：客户端默认装在 %LOCALAPPDATA%\\Programs\\lceda-pro 或 Program Files\\lceda-pro；装到别处请设 PCBP_EDA_DIR。';
	if (platform === 'darwin')
		return 'macOS：官方 zip 解压得到 LCEDA-Pro.app，拖入「应用程序」；被 Gatekeeper 拦时右键「打开」，或 sudo xattr -r -d com.apple.quarantine /Applications/LCEDA-Pro.app。';
	return 'Linux：官方 zip 解压即用、没有固定安装目录，请把 PCBP_EDA_DIR 指向解压目录（或确保 lceda-pro 在 PATH 中）。';
}
