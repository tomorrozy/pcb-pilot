import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { DaemonClient } from '../../src/daemon/client.js';

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