import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AuditLogger } from '../../src/daemon/audit.js';
import { ExtensionBridge } from '../../src/daemon/bridge.js';
import { getPaths } from '../../src/daemon/paths.js';
import { createRpcServer } from '../../src/daemon/rpc.js';
import { MockEdaClient } from '../mock-eda.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const c of cleanups.splice(0).reverse())
		await c();
});

async function setup(opts?: { timeouts?: Record<string, number>; sweepIntervalMs?: number; livenessTimeoutMs?: number }) {
	const paths = getPaths(mkdtempSync(join(tmpdir(), 'pcbp-')));
	const audit = new AuditLogger(paths.auditFile);
	const bridge = new ExtensionBridge({ port: 0, token: 'right-token', audit, outputDir: paths.outputDir, ...opts });
	const port = await bridge.start();
	cleanups.push(() => bridge.stop());
	return { paths, audit, bridge, url: `ws://127.0.0.1:${port}` };
}

async function connectMock(url: string, token = 'right-token') {
	const mock = new MockEdaClient(url, token);
	cleanups.push(() => mock.close());
	await mock.connect();
	return mock;
}

it('错误 token 被拒且 daemon 存活', async () => {
	const { bridge, url } = await setup();
	const bad = new MockEdaClient(url, 'wrong');
	await bad.connect();
	expect(bad.ack?.ok).toBe(false);
	expect(bad.ack?.error?.code).toBe('TOKEN_REJECTED');
	bad.close();
	const good = await connectMock(url);
	expect(good.ack?.ok).toBe(true);
	const res = await bridge.dispatch('sch.listNets', {});
	expect(res.ok).toBe(true);
});

it('动作往返 + 审计落盘', async () => {
	const { paths, bridge, url } = await setup();
	await connectMock(url);
	const res = await bridge.dispatch('sch.listNets', {});
	expect(res.ok).toBe(true);
	expect(res.result).toEqual({ echo: true });
	const lines = readFileSync(paths.auditFile, 'utf8').trim().split('\n');
	expect(lines).toHaveLength(1);
	const entry = JSON.parse(lines[0]);
	expect(entry.action).toBe('sch.listNets');
	expect(entry.ok).toBe(true);
});

it('无扩展 NOT_CONNECTED；未知动作 UNKNOWN_ACTION；非法参数 INVALID_PARAMS', async () => {
	const { bridge, url } = await setup();
	expect((await bridge.dispatch('sch.listNets', {})).error?.code).toBe('NOT_CONNECTED');
	await connectMock(url);
	expect((await bridge.dispatch('nope', {})).error?.code).toBe('UNKNOWN_ACTION');
	expect((await bridge.dispatch('sch.wire', { points: [[0, 0]] })).error?.code).toBe('INVALID_PARAMS');
});

it('并发动作严格串行', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	const events: string[] = [];
	mock.onAction(async (req) => {
		events.push(`${req.id}-start`);
		await new Promise(r => setTimeout(r, 50));
		events.push(`${req.id}-end`);
		return { ok: true, result: {} };
	});
	await Promise.all([bridge.dispatch('sch.listNets', {}), bridge.dispatch('sch.listComponents', {})]);
	expect(events[0]).toMatch(/-start$/);
	expect(events[1]).toBe(events[0].replace('-start', '-end'));
	expect(events[3]).toBe(events[2].replace('-start', '-end'));
});

it('超时返回 TIMEOUT', async () => {
	const { bridge, url } = await setup({ timeouts: { 'sch.listNets': 100 } });
	const mock = await connectMock(url);
	mock.onAction(() => new Promise(() => {}));
	const res = await bridge.dispatch('sch.listNets', {});
	expect(res.ok).toBe(false);
	expect(res.error?.code).toBe('TIMEOUT');
});

it('写动作 projectUuid 漂移 → READBACK_MISMATCH', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	let call = 0;
	mock.onAction(async () => {
		call++;
		return { ok: true, result: { id: `w${call}` }, readback: { projectUuid: call === 1 ? 'p1' : 'p2' } };
	});
	const first = await bridge.dispatch('sch.wire', { points: [[0, 0], [1, 1]] });
	expect(first.ok).toBe(true);
	const second = await bridge.dispatch('sch.wire', { points: [[0, 0], [2, 2]] });
	expect(second.ok).toBe(false);
	expect(second.error?.code).toBe('READBACK_MISMATCH');
	expect(bridge.getStatus().projectUuid).toBe('p1');
});

it('写动作缺 readback → READBACK_MISMATCH', async () => {
	const { bridge, url } = await setup();
	await connectMock(url);
	const res = await bridge.dispatch('sch.wire', { points: [[0, 0], [1, 1]] });
	expect(res.ok).toBe(false);
	expect(res.error?.code).toBe('READBACK_MISMATCH');
});

it('扩展断线 → pending 立即 NOT_CONNECTED', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	mock.onAction(() => new Promise(() => {}));
	const pending = bridge.dispatch('sch.listNets', {});
	await new Promise(r => setTimeout(r, 50));
	expect(bridge.getStatus().pendingCount).toBe(1);
	mock.close();
	const res = await pending;
	expect(res.ok).toBe(false);
	expect(res.error?.code).toBe('NOT_CONNECTED');
});

it('垃圾帧不崩', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	mock.sendRaw('garbage not json');
	mock.sendRaw('{"type":"bogus"}');
	const res = await bridge.dispatch('sch.listNets', {});
	expect(res.ok).toBe(true);
});

it('8MB 大结果 roundtrip 完整', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	const big = 'x'.repeat(8 * 1024 * 1024);
	mock.onAction(async () => ({ ok: true, result: { data: big } }));
	const res = await bridge.dispatch('sch.listNets', {});
	expect(res.ok).toBe(true);
	expect((res.result as { data: string }).data.length).toBe(big.length);
});

it('output.* 结果落盘，响应只回 path 不含 base64', async () => {
	const { paths, bridge, url } = await setup();
	const mock = await connectMock(url);
	mock.onAction(async () => ({ ok: true, result: { fileName: 'gerber.zip', base64: Buffer.from('ZIPDATA').toString('base64'), sizeBytes: 7 } }));
	const res = await bridge.dispatch('output.gerber', {});
	expect(res.ok).toBe(true);
	const out = res.result as { path: string; sizeBytes: number };
	expect(out.sizeBytes).toBe(7);
	expect(out.path).toBe(join(paths.outputDir, 'gerber.zip'));
	expect((res.result as Record<string, unknown>).base64).toBeUndefined();
	expect(readFileSync(out.path).toString()).toBe('ZIPDATA');
});

it('output.* 文件名防目录穿越', async () => {
	const { paths, bridge, url } = await setup();
	const mock = await connectMock(url);
	mock.onAction(async () => ({ ok: true, result: { fileName: '..\\..\\evil.zip', base64: 'AAAA', sizeBytes: 3 } }));
	const res = await bridge.dispatch('output.gerber', {});
	expect(res.ok).toBe(true);
	expect((res.result as { path: string }).path.startsWith(paths.outputDir)).toBe(true);
	expect((res.result as { path: string }).path.endsWith('evil.zip')).toBe(true);
});

it('project.open/create 成功后刷新 projectUuid 缓存', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	let current = 'p1';
	mock.onAction(async (req) => {
		if (req.action === 'project.open' || req.action === 'project.create') {
			current = 'p2';
			return { ok: true, result: {}, readback: { projectUuid: 'p2' } };
		}
		return { ok: true, result: {}, readback: { projectUuid: current } };
	});
	expect((await bridge.dispatch('sch.wire', { points: [[0, 0], [1, 1]] })).ok).toBe(true);
	expect((await bridge.dispatch('project.open', { projectUuid: 'p2' })).ok).toBe(true);
	expect(bridge.getStatus().projectUuid).toBe('p2');
	const after = await bridge.dispatch('sch.wire', { points: [[0, 0], [2, 2]] });
	expect(after.ok).toBe(true);
});

it('READBACK_MISMATCH 后锁死写入，project.open 成功可解锁', async () => {
	const { bridge, url } = await setup();
	const mock = await connectMock(url);
	let calls = 0;
	mock.onAction(async (req) => {
		calls++;
		if (req.action === 'project.open')
			return { ok: true, result: {}, readback: { projectUuid: 'p2' } };
		return { ok: true, result: {}, readback: { projectUuid: calls === 1 ? 'p1' : 'p2' } };
	});
	expect((await bridge.dispatch('sch.wire', { points: [[0, 0], [1, 1]] })).ok).toBe(true);
	const blocked = await bridge.dispatch('sch.wire', { points: [[0, 0], [2, 2]] });
	expect(blocked.error?.code).toBe('READBACK_MISMATCH');
	const callsAfterMismatch = calls;
	const stillBlocked = await bridge.dispatch('sch.wire', { points: [[0, 0], [3, 3]] });
	expect(stillBlocked.error?.code).toBe('READBACK_MISMATCH');
	expect(calls).toBe(callsAfterMismatch);
	expect((await bridge.dispatch('project.open', { projectUuid: 'p2' })).ok).toBe(true);
	expect((await bridge.dispatch('sch.wire', { points: [[0, 0], [4, 4]] })).ok).toBe(true);
});

it('长动作在 pending 期间不被存活清扫杀掉', async () => {
	const { bridge, url } = await setup({ timeouts: { 'sch.listNets': 2000 }, sweepIntervalMs: 40, livenessTimeoutMs: 80 });
	const mock = await connectMock(url);
	mock.onAction(async () => {
		await new Promise(r => setTimeout(r, 250));
		return { ok: true, result: { slow: true } };
	});
	const res = await bridge.dispatch('sch.listNets', {});
	expect(res.ok).toBe(true);
	expect(bridge.getStatus().extensionConnected).toBe(true);
});

it('output.* 非法文件名回退到安全文件名', async () => {
	const { paths, bridge, url } = await setup();
	const mock = await connectMock(url);
	mock.onAction(async () => ({ ok: true, result: { fileName: '..', base64: 'AAAA', sizeBytes: 3 } }));
	const res = await bridge.dispatch('output.gerber', {});
	expect(res.ok).toBe(true);
	const out = res.result as { path: string };
	expect(out.path.startsWith(paths.outputDir)).toBe(true);
	expect(out.path).not.toBe(join(paths.outputDir, '..'));
});

it('RPC 处理异常时返回 JSON 错误而非挂起', async () => {
	const fakeBridge = { getStatus: () => ({ extensionConnected: false, pendingCount: 0 }), dispatch: async () => { throw new Error('boom'); } } as unknown as ExtensionBridge;
	const { server, port } = await createRpcServer({ bridge: fakeBridge, version: '0.1.0', port: 0, onShutdown: () => {} });
	cleanups.push(() => new Promise<void>(r => server.close(() => r())));
	const res = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '1', method: 'action', params: { action: 'sch.listNets', params: {} } }) });
	const body = await res.json() as { ok: boolean; error?: string };
	expect(body.ok).toBe(false);
	expect(body.error).toContain('boom');
});

it('RPC status/action/shutdown', async () => {
	const { bridge, url } = await setup();
	await connectMock(url);
	let shutdownCalled = false;
	const { server, port } = await createRpcServer({ bridge, version: '0.1.0', port: 0, onShutdown: () => { shutdownCalled = true; } });
	cleanups.push(() => new Promise<void>(r => server.close(() => r())));
	const rpc = async (method: string, params?: unknown) => {
		const res = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '1', method, params }) });
		return res.json();
	};
	const status = await rpc('status');
	expect(status.result.extensionConnected).toBe(true);
	expect(status.result.daemonVersion).toBe('0.1.0');
	const action = await rpc('action', { action: 'sch.listNets', params: {} });
	expect(action.result.ok).toBe(true);
	const health = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json());
	expect(health.ok).toBe(true);
	await rpc('shutdown');
	expect(shutdownCalled).toBe(true);
});