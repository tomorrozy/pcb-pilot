import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AuditLogger } from './audit.js';
import { getPaths, loadConfig } from './paths.js';
import { loadOrCreateToken } from './token.js';

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), 'pcbp-'));
}

it('token 两次调用一致且为 64 位 hex', () => {
	const paths = getPaths(tempHome());
	const a = loadOrCreateToken(paths);
	const b = loadOrCreateToken(paths);
	expect(a).toMatch(/^[0-9a-f]{64}$/);
	expect(b).toBe(a);
});

it('loadConfig 默认端口 49630/49631', () => {
	const cfg = loadConfig(getPaths(tempHome()), {});
	expect(cfg.wsPort).toBe(49630);
	expect(cfg.rpcPort).toBe(49631);
});

it('getPaths 支持 PCBP_HOME 环境变量覆盖', () => {
	const dir = tempHome();
	process.env.PCBP_HOME = dir;
	try {
		expect(getPaths().homeDir).toBe(dir);
	}
	finally {
		delete process.env.PCBP_HOME;
	}
});

it('loadConfig env 优先于 configFile', () => {
	const paths = getPaths(tempHome());
	writeFileSync(paths.configFile, JSON.stringify({ wsPort: 1111, rpcPort: 2222 }));
	expect(loadConfig(paths, {})).toEqual({ wsPort: 1111, rpcPort: 2222 });
	expect(loadConfig(paths, { PCBP_WS_PORT: '3333' })).toEqual({ wsPort: 3333, rpcPort: 2222 });
});

it('AuditLogger 自动建目录并追加 JSONL', () => {
	const dir = tempHome();
	const file = join(dir, 'nested', 'audit.jsonl');
	const audit = new AuditLogger(file);
	audit.append({ ts: 't1', id: '1', action: 'sch.listNets', params: {}, ok: true, durationMs: 5 });
	audit.append({ ts: 't2', id: '2', action: 'sch.wire', params: { net: 'GND' }, ok: false, errorCode: 'TIMEOUT', durationMs: 30000 });
	const lines = readFileSync(file, 'utf8').trim().split('\n');
	expect(lines).toHaveLength(2);
	expect(JSON.parse(lines[1]).errorCode).toBe('TIMEOUT');
});