import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { getActionDef } from '../protocol/actions.js';
import type { ActionResponse, ErrorCode } from '../protocol/types.js';
import { parseBridgeMessage } from '../protocol/types.js';
import type { AuditLogger } from './audit.js';

export interface BridgeStatus {
	extensionConnected: boolean;
	extensionVersion?: string;
	pendingCount: number;
	projectUuid?: string;
}

interface Pending {
	id: string;
	resolve: (res: ActionResponse) => void;
	timer: NodeJS.Timeout;
}

function tokenEqual(a: string, b: string): boolean {
	const ha = createHash('sha256').update(a).digest();
	const hb = createHash('sha256').update(b).digest();
	return timingSafeEqual(ha, hb);
}

export class ExtensionBridge {
	private wss: WebSocketServer | undefined;
	private extension: WebSocket | undefined;
	private extensionVersion: string | undefined;
	private readonly pending = new Map<string, Pending>();
	private tail: Promise<unknown> = Promise.resolve();
	private projectUuid: string | undefined;
	private blocked: string | undefined;
	private lastSeen = 0;
	private sweepTimer: NodeJS.Timeout | undefined;
	private actualPort = 0;

	constructor(private readonly opts: { port: number; token: string; audit: AuditLogger; outputDir: string; timeouts?: Record<string, number>; sweepIntervalMs?: number; livenessTimeoutMs?: number }) {}

	start(): Promise<number> {
		return new Promise((resolve, reject) => {
			const wss = new WebSocketServer({ host: '127.0.0.1', port: this.opts.port, maxPayload: 64 * 1024 * 1024 });
			this.wss = wss;
			wss.on('connection', ws => this.onConnection(ws));
			wss.on('error', reject);
			wss.on('listening', () => {
				const addr = wss.address();
				this.actualPort = typeof addr === 'object' && addr ? addr.port : this.opts.port;
				this.sweepTimer = setInterval(() => {
					if (this.pending.size > 0)
						return;
					if (this.extension && Date.now() - this.lastSeen > (this.opts.livenessTimeoutMs ?? 20000))
						this.extension.terminate();
				}, this.opts.sweepIntervalMs ?? 10000);
				this.sweepTimer.unref();
				resolve(this.actualPort);
			});
		});
	}

	async stop(): Promise<void> {
		clearInterval(this.sweepTimer);
		this.dropExtension('NOT_CONNECTED', 'daemon stopping');
		this.extension?.terminate();
		this.extension = undefined;
		await new Promise<void>(r => this.wss ? this.wss.close(() => r()) : r());
		this.wss = undefined;
	}

	getStatus(): BridgeStatus {
		return {
			extensionConnected: this.extension !== undefined && this.extension.readyState === WebSocket.OPEN,
			extensionVersion: this.extensionVersion,
			pendingCount: this.pending.size,
			projectUuid: this.projectUuid,
		};
	}

	dispatch(action: string, params: Record<string, unknown>): Promise<ActionResponse> {
		const started = Date.now();
		const id = randomUUID();
		const finish = (res: ActionResponse): ActionResponse => {
			this.opts.audit.append({ ts: new Date().toISOString(), id: res.id, action, params, ok: res.ok, errorCode: res.error?.code, durationMs: Date.now() - started });
			return res;
		};
		const fail = (code: ErrorCode, message: string) =>
			finish({ type: 'result', id, ok: false, error: { code, message } });

		const def = getActionDef(action);
		if (!def)
			return Promise.resolve(fail('UNKNOWN_ACTION', `unknown action: ${action}`));
		const parsed = def.params.safeParse(params);
		if (!parsed.success)
			return Promise.resolve(fail('INVALID_PARAMS', parsed.error.message));
		if (!this.getStatus().extensionConnected)
			return Promise.resolve(fail('NOT_CONNECTED', 'no EDA extension connected'));

		const job = async (): Promise<ActionResponse> => {
			if (!this.getStatus().extensionConnected)
				return fail('NOT_CONNECTED', 'no EDA extension connected');
			if (def.write && this.blocked)
				return fail('READBACK_MISMATCH', `writes blocked after READBACK_MISMATCH (${this.blocked}); open a project to resync`);
			const timeoutMs = this.opts.timeouts?.[action] ?? def.timeoutMs;
			const response = await new Promise<ActionResponse>((resolve) => {
				const timer = setTimeout(() => {
					this.pending.delete(id);
					resolve({ type: 'result', id, ok: false, error: { code: 'TIMEOUT', message: `${action} timed out after ${timeoutMs}ms` } });
				}, timeoutMs);
				this.pending.set(id, { id, resolve, timer });
				this.extension!.send(JSON.stringify({ type: 'action', id, action, params: parsed.data }));
			});
			if (response.ok && (action === 'project.open' || action === 'project.create')) {
				const uuid = this.readbackUuid(response);
				if (typeof uuid === 'string') {
					this.projectUuid = uuid;
					this.blocked = undefined;
				}
			}
			if (response.ok && def.write) {
				const uuid = this.readbackUuid(response);
				if (typeof uuid !== 'string')
					return finish({ type: 'result', id, ok: false, error: { code: 'READBACK_MISMATCH', message: 'write action returned no readback.projectUuid' } });
				if (this.projectUuid === undefined)
					this.projectUuid = uuid;
				else if (this.projectUuid !== uuid) {
					this.blocked = `expected ${this.projectUuid}, got ${uuid}`;
					return finish({ type: 'result', id, ok: false, error: { code: 'READBACK_MISMATCH', message: `project changed: ${this.blocked}` } });
				}
			}
			if (response.ok && action.startsWith('output.'))
				this.spillOutputFile(response);
			return finish(response);
		};
		const chained = this.tail.then(job, job);
		this.tail = chained.catch(() => {});
		return chained;
	}

	private onConnection(ws: WebSocket): void {
		let greeted = false;
		this.lastSeen = Date.now();
		const helloTimer = setTimeout(() => {
			if (!greeted)
				ws.close();
		}, 5000);
		helloTimer.unref();
		ws.on('message', (data) => {
			this.lastSeen = Date.now();
			const msg = parseBridgeMessage(String(data));
			if (!msg)
				return;
			if (!greeted) {
				if (msg.type !== 'hello') {
					ws.close();
					return;
				}
				clearTimeout(helloTimer);
				if (!tokenEqual(msg.token, this.opts.token)) {
					ws.send(JSON.stringify({ type: 'hello-ack', ok: false, error: { code: 'TOKEN_REJECTED', message: 'invalid token' } }));
					ws.close();
					return;
				}
				if (this.extension && this.extension !== ws) {
					this.dropExtension('NOT_CONNECTED', 'replaced by new extension connection');
					this.extension.terminate();
				}
				greeted = true;
				this.extension = ws;
				this.extensionVersion = msg.extensionVersion;
				this.projectUuid = undefined;
				this.blocked = undefined;
				ws.send(JSON.stringify({ type: 'hello-ack', ok: true }));
				return;
			}
			if (msg.type === 'ping') {
				ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
				return;
			}
			if (msg.type === 'result') {
				const p = this.pending.get(msg.id);
				if (p) {
					this.pending.delete(msg.id);
					clearTimeout(p.timer);
					p.resolve(msg);
				}
			}
		});
		ws.on('close', () => {
			clearTimeout(helloTimer);
			if (this.extension === ws) {
				this.extension = undefined;
				this.extensionVersion = undefined;
				this.dropExtension('NOT_CONNECTED', 'extension disconnected');
			}
		});
		ws.on('error', () => {});
	}

	private readbackUuid(response: ActionResponse): unknown {
		const rb = response.readback;
		return typeof rb === 'object' && rb !== null && 'projectUuid' in rb ? (rb as { projectUuid: unknown }).projectUuid : undefined;
	}

	private spillOutputFile(response: ActionResponse): void {
		const r = response.result as { fileName?: unknown; base64?: unknown; sizeBytes?: unknown } | undefined;
		if (!r || typeof r.base64 !== 'string' || typeof r.fileName !== 'string')
			return;
		try {
			let safeName = basename(r.fileName.replace(/\\/g, '/'));
			if (!safeName || safeName === '.' || safeName === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safeName))
				safeName = `output-${Date.now()}.bin`;
			const outPath = join(this.opts.outputDir, safeName);
			mkdirSync(this.opts.outputDir, { recursive: true });
			const bytes = Buffer.from(r.base64, 'base64');
			writeFileSync(outPath, bytes);
			response.result = { path: outPath, sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : bytes.byteLength };
		}
		catch (err) {
			response.ok = false;
			response.result = undefined;
			response.error = { code: 'EDA_API_ERROR', message: `failed to save output file: ${String(err)}` };
		}
	}

	private dropExtension(code: 'NOT_CONNECTED', message: string): void {
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.resolve({ type: 'result', id: p.id, ok: false, error: { code, message } });
		}
		this.pending.clear();
	}
}