import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BridgeStatus } from './bridge.js';
import type { DaemonPaths } from './paths.js';
import { getPaths } from './paths.js';
import type { ActionResponse } from '../protocol/types.js';
import { getActionDef } from '../protocol/actions.js';

export type DaemonStatus = BridgeStatus & { daemonVersion: string; pid: number; rpcPort: number; wsPort: number };

export type ShutdownResult = 'stopped' | 'stale-cleaned' | 'still-running';

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

export function isPidAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0)
		return false;
	try {
		process.kill(pid, 0);
		return true;
	}
	catch (err) {
		// 只有 EPERM 说明「进程在、只是没权限探它」；其余（含非法 pid）一律按不存在处理
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
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
		if (!file) {
			if (this.pruneIfStale())
				throw new Error('pcb-pilot daemon is not running (stale pidfile removed)');
			throw new Error('pcb-pilot daemon is not running');
		}
		let res: Record<string, unknown>;
		try {
			res = await this.rpc('status', undefined, 500);
		}
		catch (err) {
			if (this.pruneIfStale())
				throw new Error('pcb-pilot daemon is not running (stale pidfile removed)');
			throw err;
		}
		return { ...(res as unknown as BridgeStatus), daemonVersion: res.daemonVersion as string, pid: res.pid as number, rpcPort: file.rpcPort, wsPort: file.wsPort };
	}

	async action(name: string, params: Record<string, unknown> = {}): Promise<ActionResponse> {
		const timeoutMs = (getActionDef(name)?.timeoutMs ?? 30000) + 5000;
		try {
			const res = await this.rpc('action', { action: name, params }, timeoutMs);
			return res as unknown as ActionResponse;
		}
		catch (err) {
			this.pruneIfStale();
			const code = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'TIMEOUT' : 'NOT_CONNECTED';
			return { type: 'result', id: 'unknown', ok: false, error: { code, message: `daemon request failed: ${String(err)}` } };
		}
	}

	async ensureDaemon(): Promise<DaemonStatus> {
		try {
			return await this.status();
		}
		catch {}
		const logFd = this.openDaemonLog();
		const child = spawn(process.execPath, [resolveDaemonMain()], {
			detached: true,
			stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'],
			env: { ...this.env, PCBP_HOME: this.paths.homeDir },
		});
		if (logFd !== undefined)
			closeSync(logFd);
		let spawnError: Error | undefined;
		// POSIX 上 spawn 失败是异步事件，不监听会让 CLI 直接崩
		child.once('error', (err) => {
			spawnError = err;
			this.logSpawnFailure(err);
		});
		child.unref();
		const start = Date.now();
		while (Date.now() - start < 5000) {
			if (spawnError)
				break;
			await new Promise(r => setTimeout(r, 100));
			try {
				return await this.status();
			}
			catch {}
		}
		throw new Error(`pcb-pilot daemon 未能启动${spawnError ? `：${String(spawnError)}` : ''}。启动日志：${this.paths.daemonLogFile}`);
	}

	async shutdown(): Promise<ShutdownResult> {
		try {
			await this.rpc('shutdown', undefined, 2000);
		}
		catch {}
		const start = Date.now();
		while (Date.now() - start < 3000) {
			if (!existsSync(this.paths.daemonFile))
				return 'stopped';
			if (this.pruneIfStale())
				return 'stale-cleaned';
			await new Promise(r => setTimeout(r, 100));
		}
		if (this.pruneIfStale())
			return 'stale-cleaned';
		return existsSync(this.paths.daemonFile) ? 'still-running' : 'stopped';
	}

	// 子进程的 stdout/stderr 落到数据目录：否则 stdio:'ignore' 下 daemon 启动失败的原因永久丢失
	private openDaemonLog(): number | undefined {
		try {
			mkdirSync(this.paths.homeDir, { recursive: true });
			return openSync(this.paths.daemonLogFile, 'a', 0o600);
		}
		catch {
			return undefined;
		}
	}

	private logSpawnFailure(err: Error): void {
		try {
			appendFileSync(this.paths.daemonLogFile, `[spawn] ${String(err)}\n`);
		}
		catch {}
	}

	// 只清理「确认已死」或「解析不了且不是刚写的」pidfile；绝不给任意 pid 发信号（pid 复用会误杀别的进程）
	private pruneIfStale(staleAfterMs = 5000): boolean {
		let raw: string;
		let mtimeMs = Number.NaN;
		try {
			raw = readFileSync(this.paths.daemonFile, 'utf8');
			mtimeMs = statSync(this.paths.daemonFile).mtimeMs;
		}
		catch {
			return false;
		}
		let pid: unknown;
		try {
			pid = (JSON.parse(raw) as DaemonFile).pid;
		}
		catch {
			pid = undefined;
		}
		if (Number.isSafeInteger(pid) && isPidAlive(pid as number))
			return false;
		// pid 缺失/损坏时可能是别人刚写了一半：给一个最短观察期，别抢在写入过程中删掉
		if (!Number.isSafeInteger(pid) && Date.now() - mtimeMs < staleAfterMs)
			return false;
		try {
			unlinkSync(this.paths.daemonFile);
		}
		catch {
			return false;
		}
		return true;
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