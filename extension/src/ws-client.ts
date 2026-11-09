import type { ActionRequest, ActionResponse, ErrorCode } from '../../src/protocol/types';
import { parseBridgeMessage } from '../../src/protocol/types';
import type { EdaApi } from './eda-api';
import { createDispatcher } from './dispatcher';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'rejected';

export class BridgeClient {
	private readonly socketId = 'pcb-pilot';
	private readonly dispatcher: ReturnType<typeof createDispatcher>;
	private pingTimer: ReturnType<typeof setInterval> | undefined;
	private pongTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private backoff = 1000;
	private stopped = true;
	private connected = false;

	constructor(private readonly eda: EdaApi, private readonly opts: { url: string; token: string; version: string; onStatus?: (status: ConnectionStatus) => void }) {
		this.dispatcher = createDispatcher(eda);
	}

	getStatus(): ConnectionStatus {
		return this.connected ? 'connected' : 'disconnected';
	}

	start(): void {
		if (!this.stopped)
			return;
		this.stopped = false;
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.connected = false;
		this.clearTimers();
		try {
			this.eda.sys_WebSocket.close(this.socketId);
		}
		catch {}
		this.opts.onStatus?.('disconnected');
	}

	private connect(): void {
		this.opts.onStatus?.('connecting');
		try {
			this.eda.sys_WebSocket.register(this.socketId, this.opts.url, ev => this.onMessage(ev), () => this.onConnected());
		}
		catch {
			this.scheduleReconnect();
		}
	}

	private onConnected(): void {
		if (this.stopped)
			return;
		this.connected = true;
		this.backoff = 1000;
		this.send({ type: 'hello', protocolVersion: 1, token: this.opts.token, extensionVersion: this.opts.version });
		this.startHeartbeat();
		this.opts.onStatus?.('connected');
	}

	private startHeartbeat(): void {
		this.clearTimers();
		this.pingTimer = setInterval(() => {
			this.send({ type: 'ping', ts: Date.now() });
			if (!this.pongTimer)
				this.pongTimer = setTimeout(() => this.scheduleReconnect(), 15000);
		}, 5000);
	}

	private async onMessage(ev: { data: unknown }): Promise<void> {
		const msg = parseBridgeMessage(String(ev.data));
		if (!msg)
			return;
		if (msg.type === 'pong') {
			clearTimeout(this.pongTimer);
			this.pongTimer = undefined;
			return;
		}
		if (msg.type === 'hello-ack') {
			if (!msg.ok)
				this.opts.onStatus?.('rejected');
			return;
		}
		if (msg.type === 'action') {
			const response = await this.dispatch(msg);
			this.send(response);
		}
	}

	private async dispatch(req: ActionRequest): Promise<ActionResponse> {
		try {
			const out = await this.dispatcher(req.action, req.params);
			return { type: 'result', id: req.id, ok: true, ...out };
		}
		catch (err) {
			const e = err as { code?: string; message?: string };
			return { type: 'result', id: req.id, ok: false, error: { code: (e?.code as ErrorCode) ?? 'EDA_API_ERROR', message: String(e?.message ?? err) } };
		}
	}

	private scheduleReconnect(): void {
		if (this.stopped)
			return;
		this.connected = false;
		this.clearTimers();
		try {
			this.eda.sys_WebSocket.close(this.socketId);
		}
		catch {}
		this.opts.onStatus?.('disconnected');
		const delay = this.backoff;
		this.backoff = Math.min(this.backoff * 2, 30000);
		this.reconnectTimer = setTimeout(() => {
			if (!this.stopped)
				this.connect();
		}, delay);
	}

	private send(msg: unknown): void {
		try {
			this.eda.sys_WebSocket.send(this.socketId, JSON.stringify(msg));
		}
		catch {
			this.scheduleReconnect();
		}
	}

	private clearTimers(): void {
		clearInterval(this.pingTimer);
		clearTimeout(this.pongTimer);
		clearTimeout(this.reconnectTimer);
		this.pingTimer = undefined;
		this.pongTimer = undefined;
		this.reconnectTimer = undefined;
	}
}