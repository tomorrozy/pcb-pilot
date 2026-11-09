import { expect, it, vi } from 'vitest';
import type { EdaApi } from '../src/eda-api';
import { BridgeClient } from '../src/ws-client';

function stubSocket() {
	const calls: Array<{ id: string; url: string; onMessage: (ev: { data: unknown }) => void | Promise<void>; onConnected: () => void | Promise<void> }> = [];
	const sent: string[] = [];
	const closed: string[] = [];
	const sys_WebSocket = {
		register: vi.fn((id: string, url: string, onMessage: any, onConnected: any) => {
			calls.push({ id, url, onMessage, onConnected });
		}),
		send: vi.fn((_id: string, data: string) => {
			sent.push(String(data));
		}),
		close: vi.fn((id: string) => {
			closed.push(id);
		}),
	};
	return { sys_WebSocket, calls, sent, closed };
}

function stubEda(sys_WebSocket: ReturnType<typeof stubSocket>['sys_WebSocket']): EdaApi {
	return {
		sys_WebSocket,
		lib_Device: { search: vi.fn().mockResolvedValue([{ uuid: 'dev-1' }]) },
		dmt_Project: { getCurrentProjectInfo: vi.fn().mockResolvedValue({ uuid: 'proj-1' }) },
	} as unknown as EdaApi;
}

it('连接后首帧 hello 含 token；收到 action 回 result', async () => {
	const socket = stubSocket();
	const client = new BridgeClient(stubEda(socket.sys_WebSocket), { url: 'ws://127.0.0.1:49630', token: 'tok-1', version: '0.1.0' });
	client.start();
	expect(socket.calls).toHaveLength(1);
	expect(socket.calls[0].url).toBe('ws://127.0.0.1:49630');
	await socket.calls[0].onConnected();
	const hello = JSON.parse(socket.sent[0]);
	expect(hello).toMatchObject({ type: 'hello', token: 'tok-1', extensionVersion: '0.1.0' });

	await socket.calls[0].onMessage({ data: JSON.stringify({ type: 'action', id: 'a1', action: 'library.searchDevice', params: { key: 'R0402' } }) });
	const result = JSON.parse(socket.sent[socket.sent.length - 1]);
	expect(result).toMatchObject({ type: 'result', id: 'a1', ok: true });
	client.stop();
});

it('15s 无 pong → close 并重连', async () => {
	vi.useFakeTimers();
	try {
		const socket = stubSocket();
		const client = new BridgeClient(stubEda(socket.sys_WebSocket), { url: 'ws://x', token: 't', version: '0.1.0' });
		client.start();
		await socket.calls[0].onConnected();
		await vi.advanceTimersByTimeAsync(5000);
		expect(JSON.parse(socket.sent[socket.sent.length - 1]).type).toBe('ping');
		await vi.advanceTimersByTimeAsync(15000);
		expect(socket.closed.length).toBeGreaterThanOrEqual(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(socket.calls.length).toBe(2);
		client.stop();
	}
	finally {
		vi.useRealTimers();
	}
});

it('pong 重置超时，不重连', async () => {
	vi.useFakeTimers();
	try {
		const socket = stubSocket();
		const client = new BridgeClient(stubEda(socket.sys_WebSocket), { url: 'ws://x', token: 't', version: '0.1.0' });
		client.start();
		await socket.calls[0].onConnected();
		await vi.advanceTimersByTimeAsync(5000);
		await socket.calls[0].onMessage({ data: JSON.stringify({ type: 'pong', ts: Date.now() }) });
		await vi.advanceTimersByTimeAsync(14000);
		expect(socket.calls.length).toBe(1);
		client.stop();
	}
	finally {
		vi.useRealTimers();
	}
});