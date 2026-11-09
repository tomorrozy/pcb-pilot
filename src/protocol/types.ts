export const PROTOCOL_VERSION = 1;

export type ErrorCode
	= | 'NOT_CONNECTED'
		| 'TIMEOUT'
		| 'EDA_API_ERROR'
		| 'INVALID_PARAMS'
		| 'TOKEN_REJECTED'
		| 'UNKNOWN_ACTION'
		| 'READBACK_MISMATCH';

export interface ActionError {
	code: ErrorCode;
	message: string;
}

export interface HelloMessage {
	type: 'hello';
	protocolVersion: number;
	token: string;
	extensionVersion: string;
}

export interface HelloAck {
	type: 'hello-ack';
	ok: boolean;
	error?: ActionError;
}

export interface ActionRequest {
	type: 'action';
	id: string;
	action: string;
	params: Record<string, unknown>;
}

export interface ActionResponse {
	type: 'result';
	id: string;
	ok: boolean;
	result?: unknown;
	readback?: unknown;
	error?: ActionError;
}

export interface PingMessage {
	type: 'ping';
	ts: number;
}

export interface PongMessage {
	type: 'pong';
	ts: number;
}

export type BridgeMessage = HelloMessage | HelloAck | ActionRequest | ActionResponse | PingMessage | PongMessage;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseBridgeMessage(raw: string): BridgeMessage | undefined {
	let v: unknown;
	try {
		v = JSON.parse(raw);
	}
	catch {
		return undefined;
	}
	if (!isRecord(v) || typeof v.type !== 'string')
		return undefined;
	switch (v.type) {
		case 'hello':
			if (typeof v.protocolVersion === 'number' && typeof v.token === 'string' && typeof v.extensionVersion === 'string')
				return v as unknown as HelloMessage;
			return undefined;
		case 'hello-ack':
			if (typeof v.ok === 'boolean')
				return v as unknown as HelloAck;
			return undefined;
		case 'action':
			if (typeof v.id === 'string' && typeof v.action === 'string' && isRecord(v.params))
				return v as unknown as ActionRequest;
			return undefined;
		case 'result':
			if (typeof v.id === 'string' && typeof v.ok === 'boolean')
				return v as unknown as ActionResponse;
			return undefined;
		case 'ping':
		case 'pong':
			if (typeof v.ts === 'number')
				return v as unknown as PingMessage | PongMessage;
			return undefined;
		default:
			return undefined;
	}
}