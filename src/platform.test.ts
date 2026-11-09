import { mkdirSync, mkdtempSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as posixJoin } from 'node:path/posix';
import { join, win32 } from 'node:path';
import { expect, it } from 'vitest';
import { edaClientCandidates, findEdaClient, platformNotes } from './platform.js';

const HOME_POSIX = '/home/u';

function fsOf(files: string[], dirs: string[] = files) {
	return { exists: (p: string) => files.includes(p) || dirs.includes(p), isDirectory: (p: string) => dirs.includes(p) };
}

it('PCBP_EDA_DIR 优先但只是首选，探不到仍回退到默认目录', () => {
	const missing = posixJoin('/nope', 'lceda-pro');
	const real = posixJoin('/opt', 'lceda-pro');
	const r = findEdaClient({ platform: 'linux', env: { PCBP_EDA_DIR: missing }, home: HOME_POSIX, ...fsOf([real]) });
	expect(r.found).toBe(true);
	expect(r.source).toBe('dir');
	expect(r.path).toBe(real);
	expect(r.candidates[0]).toBe(missing);
});

it('三平台都能通过 PATH 里的 lceda-pro 可执行文件命中', () => {
	const binDir = posixJoin('/opt', 'bin');
	const winBin = 'C:\\tools\\bin';
	const linux = findEdaClient({ platform: 'linux', env: { PATH: ['/nope', binDir].join(':') }, home: HOME_POSIX, ...fsOf([posixJoin(binDir, 'lceda-pro')]) });
	expect(linux.source).toBe('path');
	expect(linux.path).toBe(binDir);
	const mac = findEdaClient({ platform: 'darwin', env: { PATH: ['/nope', binDir].join(':') }, home: HOME_POSIX, ...fsOf([posixJoin(binDir, 'lceda-pro')]) });
	expect(mac.source).toBe('path');
	const win = findEdaClient({ platform: 'win32', env: { PATH: ['C:\\nope', winBin].join(win32.delimiter) }, home: 'C:\\Users\\u', ...fsOf([win32.join(winBin, 'lceda-pro.exe')]) });
	expect(win.source).toBe('path');
	expect(win.path).toBe(winBin);
});

it('win32 候选表是 Windows 分隔符，含 LOCALAPPDATA 与 Program Files', () => {
	const list = edaClientCandidates({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' }, home: 'C:\\Users\\me', ...fsOf([]) });
	expect(list).toContain('C:\\Users\\me\\AppData\\Local\\Programs\\lceda-pro');
	expect(list).toContain('C:\\Program Files\\lceda-pro');
	expect(list.some(l => l.includes('/opt/'))).toBe(false);
});

it('darwin 候选表是 POSIX 分隔符与 app bundle 路径', () => {
	const list = edaClientCandidates({ platform: 'darwin', env: {}, home: HOME_POSIX, ...fsOf([]) });
	expect(list).toContain('/Applications/LCEDA-Pro.app');
	expect(list).toContain('/home/u/Applications/LCEDA-Pro.app');
	expect(list.some(l => l.includes('\\'))).toBe(false);
});

it('linux 候选表含 /opt 与用户目录', () => {
	const list = edaClientCandidates({ platform: 'linux', env: {}, home: HOME_POSIX, ...fsOf([]) });
	expect(list).toContain('/opt/lceda-pro');
	expect(list).toContain('/home/u/lceda-pro');
});

it('全部不存在时 found=false 但仍给出候选清单', () => {
	const r = findEdaClient({ platform: 'linux', env: {}, home: HOME_POSIX, ...fsOf([]) });
	expect(r.found).toBe(false);
	expect(r.path).toBeUndefined();
	expect(r.source).toBe('none');
	expect(r.candidates.length).toBeGreaterThan(0);
});

it('候选路径是文件（非目录）时不算命中', () => {
	const r = findEdaClient({ platform: 'linux', env: {}, home: HOME_POSIX, exists: () => true, isDirectory: () => false });
	expect(r.found).toBe(false);
	expect(r.source).toBe('none');
});

it('默认判定跟随符号链接：指向目录的软链接算命中', () => {
	const root = mkdtempSync(join(tmpdir(), 'pcbp-symlink-'));
	const target = join(root, 'real');
	const link = join(root, 'link');
	let created = true;
	try {
		mkdirSync(target, { recursive: true });
		symlinkSync(target, link, 'dir');
	}
	catch {
		created = false;
	}
	try {
		const r = findEdaClient({ platform: process.platform, env: { PCBP_EDA_DIR: link }, home: root });
		if (created)
			expect(r.found).toBe(true);
		else
			expect(r.found).toBe(false);
	}
	finally {
		if (created)
			unlinkSync(link);
	}
});

it('platformNotes 给出各平台特有的补救提示', () => {
	expect(platformNotes('darwin')).toContain('Gatekeeper');
	expect(platformNotes('linux')).toContain('PCBP_EDA_DIR');
	expect(platformNotes('win32')).toContain('PCBP_EDA_DIR');
});
