import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DaemonPaths {
	homeDir: string;
	tokenFile: string;
	auditFile: string;
	daemonFile: string;
	outputDir: string;
	configFile: string;
}

export function getPaths(homeDir?: string): DaemonPaths {
	const dir = homeDir ?? join(homedir(), '.pcb-pilot');
	return {
		homeDir: dir,
		tokenFile: join(dir, 'token'),
		auditFile: join(dir, 'audit.jsonl'),
		daemonFile: join(dir, 'daemon.json'),
		outputDir: join(dir, 'output'),
		configFile: join(dir, 'config.json'),
	};
}

export interface DaemonConfig {
	wsPort: number;
	rpcPort: number;
}

export function loadConfig(paths: DaemonPaths, env: NodeJS.ProcessEnv = process.env): DaemonConfig {
	let fileCfg: Partial<DaemonConfig> = {};
	if (existsSync(paths.configFile)) {
		try {
			fileCfg = JSON.parse(readFileSync(paths.configFile, 'utf8'));
		}
		catch {
			fileCfg = {};
		}
	}
	const wsPort = Number(env.PCBP_WS_PORT ?? fileCfg.wsPort ?? 49630);
	const rpcPort = Number(env.PCBP_RPC_PORT ?? fileCfg.rpcPort ?? 49631);
	return { wsPort, rpcPort };
}