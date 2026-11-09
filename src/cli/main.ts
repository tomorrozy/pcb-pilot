#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { DaemonClient } from '../daemon/client.js';
import { startDaemon } from '../daemon/main.js';
import { runMcpServer } from '../mcp/main.js';
import { runDoctor, runInstall, runStatus, runStop } from './commands.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const program = new Command();

program.name('pcb-pilot').description('让 AI agent 操控嘉立创EDA专业版（via MCP）').version(pkg.version);

program.command('serve').description('前台运行 daemon').action(async () => {
	const daemon = await startDaemon();
	console.log(`pcb-pilot daemon listening: ws=127.0.0.1:${daemon.config.wsPort} rpc=127.0.0.1:${daemon.rpcPort}`);
	process.on('SIGINT', () => void daemon.stop().then(() => process.exit(0)));
	process.on('SIGTERM', () => void daemon.stop().then(() => process.exit(0)));
});

program.command('start').description('后台启动 daemon（已运行则复用）').action(async () => {
	try {
		const status = await new DaemonClient().ensureDaemon();
		console.log(`pcb-pilot daemon 运行中 (pid ${status.pid}) rpc=${status.rpcPort} ws=${status.wsPort}`);
	}
	catch (err) {
		console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	}
});

program.command('stop').description('停止 daemon').action(async () => {
	process.exitCode = await runStop();
});

program.command('status').description('查看 daemon 与 EDA 扩展状态').action(async () => {
	process.exitCode = await runStatus();
});

program.command('doctor').description('环境自检').option('--fix', '自动修复可修复项（生成 token、安装 Skill、启动 daemon）').action(async (opts: { fix?: boolean }) => {
	process.exitCode = await runDoctor({ fix: opts.fix });
});

program.command('install').description('安装 Agent Skill 并打印 MCP 注册命令').action(async () => {
	process.exitCode = await runInstall();
});

program.command('mcp').description('以 stdio MCP server 运行（供 agent 客户端调用）').action(async () => {
	await runMcpServer();
});

await program.parseAsync();