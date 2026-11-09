import http from 'node:http';
import type { ExtensionBridge } from './bridge.js';

export async function createRpcServer(opts: { bridge: ExtensionBridge; version: string; port: number; onShutdown: () => void }): Promise<{ server: http.Server; port: number }> {
	const server = http.createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.method === 'GET' && req.url === '/health') {
			res.end(JSON.stringify({ ok: true }));
			return;
		}
		if (req.method !== 'POST' || req.url !== '/rpc') {
			res.statusCode = 404;
			res.end(JSON.stringify({ ok: false, error: 'not found' }));
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', c => chunks.push(c as Buffer));
		req.on('end', () => {
			void (async () => {
				let body: { id?: string; method?: string; params?: { action?: string; params?: Record<string, unknown> } };
				try {
					body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				}
				catch {
					res.statusCode = 400;
					res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
					return;
				}
				const id = body.id ?? 'unknown';
				if (body.method === 'status') {
					res.end(JSON.stringify({ id, ok: true, result: { daemonVersion: opts.version, pid: process.pid, ...opts.bridge.getStatus() } }));
					return;
				}
				if (body.method === 'action' && typeof body.params?.action === 'string') {
					const result = await opts.bridge.dispatch(body.params.action, body.params.params ?? {});
					res.end(JSON.stringify({ id, ok: true, result }));
					return;
				}
				if (body.method === 'shutdown') {
					res.end(JSON.stringify({ id, ok: true }));
					opts.onShutdown();
					return;
				}
				res.statusCode = 400;
				res.end(JSON.stringify({ id, ok: false, error: 'unknown method' }));
			})();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.on('error', reject);
		server.listen(opts.port, '127.0.0.1', () => resolve());
	});
	const addr = server.address();
	const port = typeof addr === 'object' && addr ? addr.port : opts.port;
	return { server, port };
}