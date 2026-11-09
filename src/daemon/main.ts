import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AuditLogger } from './audit.js';
import { ExtensionBridge } from './bridge.js';
import type { DaemonConfig, DaemonPaths } from './paths.js';
import { getPaths, loadConfig } from './paths.js';
import { createRpcServer } from './rpc.js';
import { loadOrCreateToken } from './token.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

export async function startDaemon(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): Promise<{ paths: DaemonPaths; config: DaemonConfig; bridge: ExtensionBridge; rpcPort: number; stop: () => Promise<void> }> {
	const paths = getPaths(opts?.homeDir);
	const config = loadConfig(paths, opts?.env);
	const token = loadOrCreateToken(paths);
	const audit = new AuditLogger(paths.auditFile);
	const bridge = new ExtensionBridge({ port: config.wsPort, token, audit });
	const wsPort = await bridge.start();
	let stopped = false;
	const stop = async (): Promise<void> => {
		if (stopped)
			return;
		stopped = true;
		await new Promise<void>(r => rpc.server.close(() => r()));
		await bridge.stop();
		try {
			unlinkSync(paths.daemonFile);
		}
		catch {}
	};
	const rpc = await createRpcServer({ bridge, version: pkg.version, port: config.rpcPort, onShutdown: () => void stop() });
	writeFileSync(paths.daemonFile, JSON.stringify({ pid: process.pid, rpcPort: rpc.port, wsPort, version: pkg.version, startedAt: new Date().toISOString() }));
	return { paths, config: { wsPort, rpcPort: rpc.port }, bridge, rpcPort: rpc.port, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	startDaemon().then((d) => {
		console.log(`pcb-pilot daemon listening: ws=127.0.0.1:${d.config.wsPort} rpc=127.0.0.1:${d.rpcPort}`);
		process.on('SIGINT', () => void d.stop().then(() => process.exit(0)));
		process.on('SIGTERM', () => void d.stop().then(() => process.exit(0)));
	}).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}