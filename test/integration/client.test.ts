import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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

interface Bound {
	port: number;
	close: () => void;
}

// 逐个 freePort 可能两次拿到同一个端口（释放后立刻被复用）：一次监听全部再一起释放
function freePorts(count: number): Promise<number[]> {
	return new Promise((resolve, reject) => {
		const servers: Array<ReturnType<typeof createServer>> = [];
		const done = (ports: number[]): void => {
			for (const srv of servers)
				srv.close();
			resolve(ports);
		};
		const listen = (i: number, ports: number[]): void => {
			if (i === count) {
				done(ports);
				return;
			}
			const srv = createServer();
			servers.push(srv);
			srv.once('error', reject);
			srv.listen(0, '127.0.0.1', () => {
				const addr = srv.address();
				listen(i + 1, [...ports, typeof addr === 'object' && addr ? addr.port : 0]);
			});
		};
		listen(0, []);
	});
}

function occupyPort(): Promise<Bound> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			resolve({ port: typeof addr === 'object' && addr ? addr.port : 0, close: () => srv.close() });
		});
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
	const [wsPort, rpcPort] = await freePorts(2);
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

function writePidFile(homeDir: string, pid: number, [rpcPort, wsPort]: number[]): string {
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

it('isPidAlive 不把非法 pid 当成存活', async () => {
	const { isPidAlive } = await import('../../src/daemon/client.js');
	for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 31, 2 ** 53])
		expect(isPidAlive(bad), `pid=${bad}`).toBe(false);
});

it('损坏的 pidfile：刚写完的不动，确认陈旧后才清理', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-corrupt-'));
	const file = join(homeDir, 'daemon.json');
	writeFileSync(file, '{"pid": ra');
	const client = new DaemonClient({ homeDir });
	await expect(client.status()).rejects.toThrow(/not running/i);
	expect(existsSync(file)).toBe(true);
	const old = new Date(Date.now() - 60_000);
	utimesSync(file, old, old);
	await expect(client.status()).rejects.toThrow(/stale/i);
	expect(existsSync(file)).toBe(false);
});

it('shutdown 返回真实结果：stopped / stale-cleaned / still-running', async () => {
	const dead = mkdtempSync(join(tmpdir(), 'pcbp-sh-dead-'));
	const deadFile = writePidFile(dead, findDeadPid(), await freePorts(2));
	expect(await new DaemonClient({ homeDir: dead }).shutdown()).toBe('stale-cleaned');
	expect(existsSync(deadFile)).toBe(false);

	const gone = mkdtempSync(join(tmpdir(), 'pcbp-sh-gone-'));
	expect(await new DaemonClient({ homeDir: gone }).shutdown()).toBe('stopped');

	const hung = mkdtempSync(join(tmpdir(), 'pcbp-sh-hung-'));
	const file = writePidFile(hung, process.pid, await freePorts(2));
	expect(await new DaemonClient({ homeDir: hung }).shutdown()).toBe('still-running');
	expect(existsSync(file)).toBe(true);
}, 30000);

it('daemon 起不来时把原因留在 daemon.log 并在报错里指路', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-badstart-'));
	const blocker = await occupyPort();
	const client = new DaemonClient({
		homeDir,
		env: { PCBP_HOME: homeDir, PCBP_WS_PORT: String(blocker.port), PCBP_RPC_PORT: '0' } as NodeJS.ProcessEnv,
	});
	try {
		await expect(client.ensureDaemon()).rejects.toThrow(/daemon\.log/);
	}
	finally {
		blocker.close();
	}
	const log = await waitFor(() => {
		const text = readFileSync(join(homeDir, 'daemon.log'), 'utf8');
		if (!text)
			throw new Error('daemon.log still empty');
		return text;
	}, 5000);
	expect(log).toContain('EADDRINUSE');
}, 30000);

it('陈旧 pidfile：status 抛错并清理 daemon.json', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-stale-'));
	const file = writePidFile(homeDir, findDeadPid(), await freePorts(2));
	const client = new DaemonClient({ homeDir });
	await expect(client.status()).rejects.toThrow(/stale/i);
	expect(existsSync(file)).toBe(false);
});

it('pid 仍在但 RPC 不通：保留 pidfile（可能正在启动）', async () => {
	const homeDir = mkdtempSync(join(tmpdir(), 'pcbp-alive-'));
	const file = writePidFile(homeDir, process.pid, await freePorts(2));
	const client = new DaemonClient({ homeDir });
	await expect(client.status()).rejects.toThrow();
	expect(existsSync(file)).toBe(true);
	try {
		unlinkSync(file);
	}
	catch {}
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
}, 30000);