import WebSocket from 'ws';
import type { ActionRequest, ActionResponse, HelloAck } from '../src/protocol/types.js';
import { parseBridgeMessage } from '../src/protocol/types.js';

export class MockEdaClient {
	ack: HelloAck | undefined;
	private ws: WebSocket | undefined;
	private handler: (req: ActionRequest) => Promise<Partial<ActionResponse>> = async () => ({ ok: true, result: { echo: true } });

	constructor(private readonly url: string, private readonly token: string) {}

	onAction(handler: (req: ActionRequest) => Promise<Partial<ActionResponse>>): void {
		this.handler = handler;
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(this.url);
			this.ws = ws;
			ws.on('open', () => {
				ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, token: this.token, extensionVersion: '0.1.0-mock' }));
			});
			ws.on('message', (data) => {
				const msg = parseBridgeMessage(String(data));
				if (!msg)
					return;
				if (msg.type === 'hello-ack') {
					this.ack = msg;
					resolve();
					return;
				}
				if (msg.type === 'action') {
					void this.handler(msg).then((partial) => {
						if (ws.readyState === WebSocket.OPEN)
							ws.send(JSON.stringify({ type: 'result', id: msg.id, ...partial }));
					});
				}
			});
			ws.on('error', reject);
		});
	}

	sendRaw(data: string): void {
		this.ws?.send(data);
	}

	close(): void {
		this.ws?.close();
	}
}