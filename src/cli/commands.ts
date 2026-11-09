import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DaemonClient } from '../daemon/client.js';
import { getPaths, type DaemonPaths } from '../daemon/paths.js';
import { loadOrCreateToken } from '../daemon/token.js';
import { findEdaClient, platformNotes } from '../platform.js';
import { defaultTargets, installSkill, registrationSnippets } from './install.js';

export interface CommandOptions {
	homeDir?: string;
	userHome?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	fix?: boolean;
	log?: (line: string) => void;
}

type CheckLevel = 'ok' | 'warn' | 'fail';

interface Check {
	level: CheckLevel;
	label: string;
	hint?: string;
}

const MARKS: Record<CheckLevel, string> = { ok: '✓', warn: '!', fail: '✗' };

function skillSource(): string {
	return fileURLToPath(new URL('../../skill', import.meta.url));
}

export async function runStatus(opts: CommandOptions = {}): Promise<number> {
	const log = opts.log ?? console.log;
	const paths = getPaths(opts.homeDir);
	try {
		const status = await new DaemonClient({ homeDir: opts.homeDir }).status();
		log(`✓ daemon 运行中 (pid ${status.pid}) rpc=${status.rpcPort} ws=${status.wsPort}`);
		log(`${status.extensionConnected ? '✓' : '✗'} EDA 扩展${status.extensionConnected ? '已连接' : '未连接'}${status.extensionVersion ? ` v${status.extensionVersion}` : ''}`);
		if (status.projectUuid)
			log(`  当前工程: ${status.projectUuid}`);
		log(`  配对 token: ${paths.tokenFile}`);
		return status.extensionConnected ? 0 : 1;
	}
	catch {
		log('✗ daemon 未运行：先运行 pcb-pilot start（或在 EDA 里重连扩展前启动）');
		log(`  配对 token: ${paths.tokenFile}（daemon 首次启动后生成）`);
		return 1;
	}
}

// 只修「不依赖 EDA 端」的项：token、Skill、daemon。扩展是否连上只能由用户去 EDA 里操作
async function applyFixes(opts: { paths: DaemonPaths; userHome: string; env: NodeJS.ProcessEnv; log: (line: string) => void }): Promise<void> {
	const fixed: Array<string> = [];
	const failed: Array<string> = [];
	try {
		loadOrCreateToken(opts.paths);
		fixed.push(`token 就绪（${opts.paths.tokenFile}）`);
	}
	catch (err) {
		failed.push(`生成 token 失败：${String(err)}`);
	}
	const installed = defaultTargets(opts.userHome).filter(t => existsSync(join(t.dir, 'SKILL.md')));
	if (installed.length === 0) {
		try {
			const res = installSkill({ homeDir: opts.userHome, skillSrc: skillSource() });
			fixed.push(`Skill 已安装到 ${res.installed.length} 个客户端目录`);
		}
		catch (err) {
			failed.push(`安装 Skill 失败：${String(err)}`);
		}
	}
	else {
		fixed.push(`Skill 已就绪（${installed.length} 处）`);
	}
	const client = new DaemonClient({ homeDir: opts.paths.homeDir, env: opts.env });
	try {
		await client.status();
		fixed.push('daemon 已在运行');
	}
	catch {
		try {
			const st = await client.ensureDaemon();
			fixed.push(`daemon 已启动 (pid ${st.pid})`);
		}
		catch (err) {
			failed.push(`启动 daemon 失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}
	opts.log('自动修复：');
	for (const line of fixed)
		opts.log(`  + ${line}`);
	for (const line of failed)
		opts.log(`  - ${line}`);
	opts.log('');
}

export async function runDoctor(opts: CommandOptions = {}): Promise<number> {
	const log = opts.log ?? console.log;
	const env = opts.env ?? process.env;
	const platform = opts.platform ?? process.platform;
	const userHome = opts.userHome ?? homedir();
	const paths = getPaths(opts.homeDir);
	const results: Array<Check> = [];

	if (opts.fix)
		await applyFixes({ paths, userHome, env, log });

	const nodeParts = process.versions.node.split('.').map(Number);
	const nodeOk = nodeParts[0] > 20 || (nodeParts[0] === 20 && nodeParts[1] >= 17);
	results.push({ level: nodeOk ? 'ok' : 'fail', label: `Node.js ${process.versions.node} (要求 >= 20.17)`, hint: nodeOk ? undefined : '升级 Node.js 到 20.17 以上' });

	const eda = findEdaClient({ platform, env, home: userHome });
	const edaEnvMismatch = Boolean(env.PCBP_EDA_DIR) && env.PCBP_EDA_DIR !== eda.path;
	if (eda.found && !edaEnvMismatch)
		results.push({ level: 'ok', label: `EDA客户端 ${eda.path}（来源 ${eda.source}）` });
	else {
		const hints: Array<string> = [];
		if (edaEnvMismatch)
			hints.push(`PCBP_EDA_DIR 指向的目录不存在（${env.PCBP_EDA_DIR}）`);
		if (eda.found)
			hints.push(`已回退到 ${eda.path}（来源 ${eda.source}）`);
		else
			hints.push(`候选 ${eda.candidates.slice(0, 4).join(' | ')}`);
		hints.push(platformNotes(platform));
		results.push({
			level: 'warn',
			label: eda.found
				? `EDA客户端 ${eda.path}（来源 ${eda.source}）`
				: 'EDA客户端 未探测到（扩展连上即视为可用，不影响 agent 链路）',
			hint: hints.join('；'),
		});
	}

	let daemonStatus: Awaited<ReturnType<DaemonClient['status']>> | undefined;
	try {
		daemonStatus = await new DaemonClient({ homeDir: opts.homeDir, env }).status();
		results.push({ level: 'ok', label: 'daemon 运行中' });
	}
	catch {
		results.push({ level: 'fail', label: 'daemon 未运行', hint: '运行 pcb-pilot start 启动 daemon' });
	}

	results.push({
		level: daemonStatus?.extensionConnected === true ? 'ok' : 'fail',
		label: 'EDA 扩展已连接 daemon',
		hint: daemonStatus?.extensionConnected ? undefined : 'EDA 中安装 .eext、开启「允许外部交互」，菜单 PCB Pilot → 设置 Token 后重连',
	});
	results.push({ level: existsSync(paths.tokenFile) ? 'ok' : 'fail', label: `配对 token 存在 (${paths.tokenFile})`, hint: existsSync(paths.tokenFile) ? undefined : '启动 daemon 会自动生成 token' });
	const installed = defaultTargets(userHome).filter(t => existsSync(join(t.dir, 'SKILL.md')));
	results.push({ level: installed.length > 0 ? 'ok' : 'fail', label: 'Agent Skill 已安装', hint: installed.length > 0 ? undefined : '运行 pcb-pilot install 安装 Skill 到 Claude Code / Codex / Qoder' });

	for (const r of results) {
		log(`${MARKS[r.level]} ${r.label}`);
		if (r.hint)
			log(`    → ${r.hint}`);
	}
	log('');
	log('EDA 端检查清单：');
	log('  1. 扩展管理器安装 pcb-pilot-bridge .eext 并启用');
	log('  2. 打开「允许外部交互」');
	log('  3. 菜单 PCB Pilot → 设置 Token（pcb-pilot status 会显示 token 路径）');
	log('  4. 打开原理图或 PCB 文档后执行菜单「重连」');
	log('');
	log(platformNotes(platform));
	return results.some(r => r.level === 'fail') ? 1 : 0;
}

export async function runStop(opts: CommandOptions = {}): Promise<number> {
	const log = opts.log ?? console.log;
	const paths = getPaths(opts.homeDir);
	const result = await new DaemonClient({ homeDir: opts.homeDir }).shutdown();
	if (result === 'stopped')
		log('✓ pcb-pilot daemon 已停止');
	else if (result === 'stale-cleaned')
		log(`✓ daemon 进程已不在，清理了陈旧的 ${paths.daemonFile}`);
	else {
		log('✗ daemon 进程还在，但没有响应停止请求');
		log(`    → 查看 ${paths.daemonLogFile}；确认后可以手动结束进程（本工具不会替你强杀任意 pid）`);
		return 1;
	}
	return 0;
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