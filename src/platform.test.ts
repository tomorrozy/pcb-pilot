import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { edaClientCandidates, findEdaClient, platformNotes } from './platform.js';

const HOME = join('?', 'home', 'u');

function fsOf(paths: string[]) {
	return { exists: (p: string) => paths.includes(p), isDirectory: (p: string) => paths.includes(p) };
}

it('PCBP_EDA_DIR 优先且标记为 env 来源', () => {
	const dir = join('X:', 'my', 'lceda-pro');
	const r = findEdaClient({ platform: 'win32', env: { PCBP_EDA_DIR: dir }, home: HOME, ...fsOf([dir]) });
	expect(r.found).toBe(true);
	expect(r.path).toBe(dir);
	expect(r.source).toBe('env');
});

it('win32 候选含 LOCALAPPDATA 与 Program Files 两种安装位置，不含 POSIX 目录', () => {
	const local = join('C:', 'Users', 'me', 'AppData', 'Local');
	const pf = join('C:', 'Program Files');
	const list = edaClientCandidates({ platform: 'win32', env: { LOCALAPPDATA: local, PROGRAMFILES: pf }, home: HOME, ...fsOf([]) });
	expect(list).toContain(join(local, 'Programs', 'lceda-pro'));
	expect(list).toContain(join(pf, 'lceda-pro'));
	expect(list).not.toContain('/opt/lceda-pro');
	expect(list).not.toContain('/Applications/LCEDA-Pro.app');
});

it('darwin 候选含系统级与用户级 app bundle', () => {
	const list = edaClientCandidates({ platform: 'darwin', env: {}, home: HOME, ...fsOf([]) });
	expect(list).toContain('/Applications/LCEDA-Pro.app');
	expect(list).toContain(join(HOME, 'Applications', 'LCEDA-Pro.app'));
	expect(list).not.toContain(join('C:', 'Program Files', 'lceda-pro'));
});

it('linux 候选含 /opt 与用户目录', () => {
	const list = edaClientCandidates({ platform: 'linux', env: {}, home: HOME, ...fsOf([]) });
	expect(list).toContain('/opt/lceda-pro');
	expect(list).toContain(join(HOME, 'lceda-pro'));
});

it('三平台都能通过 PATH 里的 lceda-pro 可执行文件命中', () => {
	const binDir = join('?', 'some', 'bin');
	const missing = join('?', 'nope');
	const exe = (name: string) => join(binDir, name);
	const pathEnv = [missing, binDir].join(delimiter);
	const win = findEdaClient({ platform: 'win32', env: { PATH: pathEnv }, home: HOME, ...fsOf([exe('lceda-pro.exe')]) });
	expect(win.source).toBe('path');
	expect(win.path).toBe(binDir);
	const mac = findEdaClient({ platform: 'darwin', env: { PATH: pathEnv }, home: HOME, ...fsOf([exe('lceda-pro')]) });
	expect(mac.source).toBe('path');
	const linux = findEdaClient({ platform: 'linux', env: { PATH: pathEnv }, home: HOME, ...fsOf([exe('lceda-pro')]) });
	expect(linux.source).toBe('path');
});

it('全部不存在时 found=false 但仍给出候选清单', () => {
	const r = findEdaClient({ platform: 'linux', env: {}, home: HOME, ...fsOf([]) });
	expect(r.found).toBe(false);
	expect(r.path).toBeUndefined();
	expect(r.source).toBe('none');
	expect(r.candidates.length).toBeGreaterThan(0);
});

it('候选路径是文件（非目录）时不算命中', () => {
	const dir = join('?', 'opt', 'lceda-pro');
	const r = findEdaClient({ platform: 'linux', env: {}, home: HOME, exists: p => p === dir, isDirectory: () => false });
	expect(r.found).toBe(false);
});

it('platformNotes 给出各平台特有的补救提示', () => {
	expect(platformNotes('darwin')).toContain('Gatekeeper');
	expect(platformNotes('linux')).toContain('PCBP_EDA_DIR');
	expect(platformNotes('win32')).toContain('PCBP_EDA_DIR');
});
