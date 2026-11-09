import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BridgeStatus } from './bridge.js';
import type { DaemonPaths } from './paths.js';
import { getPaths } from './paths.js';
import type { ActionResponse } from '../protocol/types.js';

export type DaemonStatus = BridgeStatus & { daemonVersion: string; pid: number; rpcPort: number; wsPort: number };

interface DaemonFile {
	pid: number;
	rpcPort: number;
	wsPort: number;
	version: string;
	startedAt: string;
}

const daemonMainCandidates = [
	new URL('../daemon/main.js', import.meta.url),
	new URL('../../dist/daemon/main.js', import.meta.url),
].map(u => fileURLToPath(u));

function resolveDaemonMain(): string {
	const found = daemonMainCandidates.find(p => existsSync(p));
	if (!found)
		throw new Error(`daemon entry not found (looked in: ${daemonMainCandidates.join(', ')}); run npm run build first`);
	return found;
}

export class DaemonClient {
	private readonly paths: DaemonPaths;
	private readonly env: NodeJS.ProcessEnv;

	constructor(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }) {
		this.paths = getPaths(opts?.homeDir);
		this.env = { ...process.env, ...opts?.env };
	}

	async status(): Promise<DaemonStatus> {
		const file = this.readDaemonFile();
		if (!file)
			throw new Error('pcb-pilot daemon is not running');
		const res = await this.rpc('status', undefined, 500);
		return { ...(res as unknown as BridgeStatus), daemonVersion: res.daemonVersion as string, pid: res.pid as number, rpcPort: file.rpcPort, wsPort: file.wsPort };
	}

	async action(name: string, params: Record<string, unknown> = {}): Promise<ActionResponse> {
		try {
			const res = await this.rpc('action', { action: name, params });
			return res as unknown as ActionResponse;
		}
		catch (err) {
			return { type: 'result', id: 'unknown', ok: false, error: { code: 'NOT_CONNECTED', message: `daemon unreachable: ${String(err)}` } };
		}
	}

	async ensureDaemon(): Promise<DaemonStatus> {
		try {
			return await this.status();
		}
		catch {}
		const child = spawn(process.execPath, [resolveDaemonMain()], {
			detached: true,
			stdio: 'ignore',
			env: { ...this.env, PCBP_HOME: this.paths.homeDir },
		});
		child.unref();
		const start = Date.now();
		let lastErr: unknown;
		while (Date.now() - start < 5000) {
			await new Promise(r => setTimeout(r, 100));
			try {
				return await this.status();
			}
			catch (err) {
				lastErr = err;
			}
		}
		throw lastErr ?? new Error('timed out waiting for daemon to start');
	}

	async shutdown(): Promise<void> {
		try {
			await this.rpc('shutdown', undefined, 2000);
		}
		catch {}
		const start = Date.now();
		while (Date.now() - start < 3000) {
			if (!existsSync(this.paths.daemonFile))
				return;
			await new Promise(r => setTimeout(r, 100));
		}
	}

	private readDaemonFile(): DaemonFile | undefined {
		if (!existsSync(this.paths.daemonFile))
			return undefined;
		try {
			return JSON.parse(readFileSync(this.paths.daemonFile, 'utf8')) as DaemonFile;
		}
		catch {
			return undefined;
		}
	}

	private async rpc(method: string, params?: unknown, timeoutMs = 5000): Promise<Record<string, unknown>> {
		const file = this.readDaemonFile();
		if (!file)
			throw new Error('pcb-pilot daemon is not running');
		const res = await fetch(`http://127.0.0.1:${file.rpcPort}/rpc`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: '1', method, params }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body = await res.json() as { ok: boolean; result?: Record<string, unknown>; error?: string };
		if (!body.ok || !body.result)
			throw new Error(body.error ?? 'rpc failed');
		return body.result;
	}
}