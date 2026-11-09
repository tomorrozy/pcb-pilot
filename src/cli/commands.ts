import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from '../daemon/client.js';
import { getPaths } from '../daemon/paths.js';
import { defaultTargets, installSkill, registrationSnippets } from './install.js';

export interface CommandOptions {
	homeDir?: string;
	userHome?: string;
	env?: NodeJS.ProcessEnv;
	log?: (line: string) => void;
}

function skillSource(): string {
	return fileURLToPath(new URL('../../skill', import.meta.url));
}

export async function runStatus(opts: CommandOptions = {}): Promise<number> {
	const log = opts.log ?? console.log;
	try {
		const status = await new DaemonClient({ homeDir: opts.homeDir }).status();
		log(`✓ daemon 运行中 (pid ${status.pid}) rpc=${status.rpcPort} ws=${status.wsPort}`);
		log(`${status.extensionConnected ? '✓' : '✗'} EDA 扩展${status.extensionConnected ? '已连接' : '未连接'}${status.extensionVersion ? ` v${status.extensionVersion}` : ''}`);
		if (status.projectUuid)
			log(`  当前工程: ${status.projectUuid}`);
		return status.extensionConnected ? 0 : 1;
	}
	catch {
		log('✗ daemon 未运行：先运行 pcb-pilot start（或在 EDA 里重连扩展前启动）');
		return 1;
	}
}

export async function runDoctor(opts: CommandOptions = {}): Promise<number> {
	const log = opts.log ?? console.log;
	const env = opts.env ?? process.env;
	const userHome = opts.userHome ?? homedir();
	const paths = getPaths(opts.homeDir);
	const results: Array<{ ok: boolean; label: string; hint?: string }> = [];

	const nodeParts = process.versions.node.split('.').map(Number);
	const nodeOk = nodeParts[0] > 20 || (nodeParts[0] === 20 && nodeParts[1] >= 17);
	results.push({ ok: nodeOk, label: `Node.js ${process.versions.node} (要求 >= 20.17)`, hint: nodeOk ? undefined : '升级 Node.js 到 20.17 以上' });

	if (process.platform === 'win32') {
		const edaDir = env.PCBP_EDA_DIR ?? join(env.LOCALAPPDATA ?? '', 'Programs', 'lceda-pro');
		results.push({ ok: existsSync(edaDir), label: `嘉立创EDA专业版客户端目录存在`, hint: `未找到 ${edaDir}；安装专业版客户端或设置 PCBP_EDA_DIR` });
	}
	else {
		results.push({ ok: true, label: '非 Windows 平台，跳过 EDA 客户端路径检查' });
	}

	let daemonStatus: Awaited<ReturnType<DaemonClient['status']>> | undefined;
	try {
		daemonStatus = await new DaemonClient({ homeDir: opts.homeDir }).status();
		results.push({ ok: true, label: 'daemon 运行中' });
	}
	catch {
		results.push({ ok: false, label: 'daemon 未运行', hint: '运行 pcb-pilot start 启动 daemon' });
	}

	results.push({
		ok: daemonStatus?.extensionConnected === true,
		label: 'EDA 扩展已连接 daemon',
		hint: daemonStatus?.extensionConnected ? undefined : 'EDA 中安装 .eext、开启「允许外部交互」，菜单 PCB Pilot → 设置 Token 后重连',
	});
	results.push({ ok: existsSync(paths.tokenFile), label: `配对 token 存在 (${paths.tokenFile})`, hint: '启动 daemon 会自动生成 token' });
	const installed = defaultTargets(userHome).filter(t => existsSync(join(t.dir, 'SKILL.md')));
	results.push({ ok: installed.length > 0, label: 'Agent Skill 已安装', hint: '运行 pcb-pilot install 安装 Skill 到 Claude Code / Codex / Qoder' });

	for (const r of results) {
		log(`${r.ok ? '✓' : '✗'} ${r.label}`);
		if (!r.ok && r.hint)
			log(`    → ${r.hint}`);
	}
	log('');
	log('EDA 端检查清单：');
	log('  1. 扩展管理器安装 pcb-pilot-bridge .eext 并启用');
	log('  2. 打开「允许外部交互」');
	log('  3. 菜单 PCB Pilot → 设置 Token（pcb-pilot status 会显示 token 路径）');
	log('  4. 打开原理图或 PCB 文档后执行菜单「重连」');
	return results.every(r => r.ok) ? 0 : 1;
}

export async function runInstall(opts: CommandOptions = {}): Promise<number> {
	const log = opts.log ?? console.log;
	const userHome = opts.userHome ?? homedir();
	const { installed } = installSkill({ homeDir: userHome, skillSrc: skillSource() });
	for (const dir of installed)
		log(`✓ Skill 已安装: ${dir}`);
	log('');
	log(registrationSnippets());
	log('');
	log('接下来：在 EDA 里安装 .eext（见 README / GitHub Release），开启「允许外部交互」，回到 EDA 菜单 PCB Pilot → 设置 Token。');
	return 0;
}