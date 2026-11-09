import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { DaemonClient } from '../../src/daemon/client.js';
import { startDaemon } from '../../src/daemon/main.js';
import { MockEdaClient } from '../mock-eda.js';

let pid: number | undefined;

afterAll(async () => {
	if (pid) {
		try {
			process.kill(pid);
		}
		catch {}
	}
});

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
		});
		srv.on('error', reject);
	});
}

async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
	const start = Date.now();
	let lastErr: unknown;
	while (Date.now() - start < timeoutMs) {
		try {
			return await fn();
		}
		catch (err) {
			lastErr = err;
			await new Promise(r => setTimeout(r, 100));
		}
	}
	throw lastErr ?? new Error('timeout');
}

it('ensureDaemon 拉起真实 daemon 并返回 status', async () => {
	execSync('npm run build', { cwd: new URL('../..', import.meta.url), stdio: 'pipe' });
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-'));
	const wsPort = await freePort();
	const rpcPort = await freePort();
	const client = new DaemonClient({ homeDir, env: { PCBP_HOME: homeDir, PCBP_WS_PORT: String(wsPort), PCBP_RPC_PORT: String(rpcPort) } as NodeJS.ProcessEnv });
	const status = await client.ensureDaemon();
	pid = status.pid;
	expect(status.daemonVersion).toBe('0.1.0');
	expect(status.wsPort).toBe(wsPort);
	expect(status.extensionConnected).toBe(false);

	const res = await client.action('sch.listNets');
	expect(res.ok).toBe(false);
	expect(res.error?.code).toBe('NOT_CONNECTED');

	await client.shutdown();
	await waitFor(async () => {
		if (existsSync(join(homeDir, 'daemon.json')))
			throw new Error('daemon.json still exists');
		return true;
	}, 3000);
	const file = join(homeDir, 'daemon.json');
	expect(existsSync(file)).toBe(false);
	await expect(client.status()).rejects.toThrow();
	const audit = readFileSync(join(homeDir, 'audit.jsonl'), 'utf8').trim().split('\n');
	expect(JSON.parse(audit[audit.length - 1]).action).toBe('sch.listNets');
});

function writePidFile(homeDir: string, pid: number, rpcPort: number, wsPort: number): string {
	const file = join(homeDir, 'daemon.json');
	writeFileSync(file, JSON.stringify({ pid, rpcPort, wsPort, version: '0.1.0', startedAt: new Date().toISOString() }));
	return file;
}

function findDeadPid(): number {
	for (let candidate = 1_000_000; candidate < 1_000_100; candidate++) {
		try {
			process.kill(candidate, 0);
		}
		catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ESRCH')
				return candidate;
		}
	}
	throw new Error('no unused pid found');
}

it('isPidAlive 区分自己（活）与未使用的 pid（死）', async () => {
	const { isPidAlive } = await import('../../src/daemon/client.js');
	expect(isPidAlive(process.pid)).toBe(true);
	expect(isPidAlive(findDeadPid())).toBe(false);
});

it('陈旧 pidfile：status 抛错并清理 daemon.json', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-stale-'));
	const file = writePidFile(homeDir, findDeadPid(), await freePort(), await freePort());
	const client = new DaemonClient({ homeDir });
	await expect(client.status()).rejects.toThrow(/stale/i);
	expect(existsSync(file)).toBe(false);
});

it('pid 仍在但 RPC 不通：保留 pidfile（可能正在启动）', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-alive-'));
	const file = writePidFile(homeDir, process.pid, await freePort(), await freePort());
	const client = new DaemonClient({ homeDir });
	await expect(client.status()).rejects.toThrow();
	expect(existsSync(file)).toBe(true);
	try {
		unlinkSync(file);
	}
	catch {}
});

it('shutdown 在无响应但进程已死时清理 pidfile', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-shutdown-'));
	const file = writePidFile(homeDir, findDeadPid(), await freePort(), await freePort());
	const client = new DaemonClient({ homeDir });
	await client.shutdown();
	expect(existsSync(file)).toBe(false);
});

it('长动作（>5s）客户端不中途超时', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-long-'));
	const daemon = await startDaemon({ homeDir, env: { PCBP_WS_PORT: '0', PCBP_RPC_PORT: '0' } as NodeJS.ProcessEnv });
	try {
		const token = readFileSync(join(homeDir, 'token'), 'utf8').trim();
		const mock = new MockEdaClient(`ws://127.0.0.1:${daemon.config.wsPort}`, token);
		await mock.connect();
		mock.onAction(async () => {
			await new Promise(r => setTimeout(r, 5500));
			return { ok: true, result: { slow: true } };
		});
		const client = new DaemonClient({ homeDir });
		const res = await client.action('output.gerber');
		expect(res.ok).toBe(true);
		expect((res.result as { slow: boolean }).slow).toBe(true);
		mock.close();
	}
	finally {
		await daemon.stop();
	}
}, 15000);