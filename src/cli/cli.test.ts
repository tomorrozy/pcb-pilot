import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DaemonClient } from '../daemon/client.js';
import { runDoctor, runStatus, runStop } from './commands.js';
import { defaultTargets, installSkill, registrationSnippets } from './install.js';

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

it('installSkill 安装到三个客户端技能目录', () => {
	const home = tempDir('pcbp-home-');
	const skillSrc = tempDir('pcbp-skill-');
	writeFileSync(join(skillSrc, 'SKILL.md'), '# PCB Pilot');
	const { installed } = installSkill({ homeDir: home, skillSrc });
	expect(installed).toHaveLength(3);
	for (const target of defaultTargets(home))
		expect(existsSync(join(target.dir, 'SKILL.md'))).toBe(true);
});

it('registrationSnippets 含 claude/codex 注册命令', () => {
	const text = registrationSnippets();
	expect(text).toContain('claude mcp add');
	expect(text).toContain('codex mcp add');
});

it('runDoctor 全缺失时 exit 1 且提示允许外部交互', async () => {
	const home = tempDir('pcbp-home-');
	const logs: string[] = [];
	const code = await runDoctor({
		homeDir: join(home, '.pcb-pilot'),
		userHome: home,
		platform: 'win32',
		env: { LOCALAPPDATA: tempDir('pcbp-empty-') } as NodeJS.ProcessEnv,
		log: s => logs.push(s),
	});
	expect(code).toBe(1);
	expect(logs.join('\n')).toContain('允许外部交互');
});

it('runDoctor darwin：PCBP_EDA_DIR 命中时报告客户端路径与来源', async () => {
	const home = tempDir('pcbp-home-');
	const edaDir = tempDir('pcbp-eda-');
	const logs: string[] = [];
	const code = await runDoctor({
		homeDir: join(home, '.pcb-pilot'),
		userHome: home,
		platform: 'darwin',
		env: { PCBP_EDA_DIR: edaDir } as NodeJS.ProcessEnv,
		log: s => logs.push(s),
	});
	const line = logs.find(l => l.includes('EDA客户端'));
	expect(line).toBeDefined();
	expect(line!.startsWith('✓')).toBe(true);
	expect(line).toContain(edaDir);
	expect(line).toContain('env');
	expect(code).toBe(1);
});

it('runDoctor linux：探不到 EDA 客户端只算提示项，不计入失败', async () => {
	const home = tempDir('pcbp-home-');
	const logs: string[] = [];
	const code = await runDoctor({
		homeDir: join(home, '.pcb-pilot'),
		userHome: home,
		platform: 'linux',
		env: { PCBP_EDA_DIR: join(home, 'no-such-eda-dir') } as NodeJS.ProcessEnv,
		log: s => logs.push(s),
	});
	const line = logs.find(l => l.includes('EDA客户端'));
	expect(line!.startsWith('!')).toBe(true);
	expect(logs.filter(l => l.startsWith('✗')).some(l => l.includes('EDA客户端'))).toBe(false);
	expect(logs.join('\n')).toContain('PCBP_EDA_DIR');
	// 这里唯一让 doctor 失败的是 daemon/Skill 未就绪，EDA 目录探测不参与退出码
	expect(code).toBe(1);
});

it('runDoctor：PCBP_EDA_DIR 指错时点名该变量，不再让用户重设同一个值', async () => {
	const home = tempDir('pcbp-home-');
	const bad = join(home, 'no-such-eda-dir');
	const logs: string[] = [];
	await runDoctor({
		homeDir: join(home, '.pcb-pilot'),
		userHome: home,
		platform: 'linux',
		env: { PCBP_EDA_DIR: bad } as NodeJS.ProcessEnv,
		log: s => logs.push(s),
	});
	const idx = logs.findIndex(l => l.includes('EDA客户端'));
	expect(logs[idx + 1]).toContain('PCBP_EDA_DIR 指向的目录不存在');
	expect(logs[idx + 1]).toContain(bad);
});

it('runStop：数据目录什么都没有时报告已停止', async () => {
	const home = tempDir('pcbp-home-');
	const logs: string[] = [];
	expect(await runStop({ homeDir: join(home, '.pcb-pilot'), log: s => logs.push(s) })).toBe(0);
	expect(logs.join('\n')).toContain('已停止');
});

it('runStop：陈旧 pidfile 要说清是「清理」而不是「已停止」', async () => {
	const dir = join(tempDir('pcbp-home-'), '.pcb-pilot');
	mkdirSync(dir, { recursive: true });
	const file = join(dir, 'daemon.json');
	writeFileSync(file, JSON.stringify({ pid: 2 ** 31, rpcPort: 1, wsPort: 1, version: '0', startedAt: '' }));
	const logs: string[] = [];
	expect(await runStop({ homeDir: dir, log: s => logs.push(s) })).toBe(0);
	expect(logs.join('\n')).toContain('陈旧');
	expect(existsSync(file)).toBe(false);
});

it('runDoctor --fix 生成 token、安装 Skill、启动 daemon 后再出报告', async () => {
	const home = tempDir('pcbp-home-');
	const homeDir = join(home, '.pcb-pilot');
	const env = { PCBP_HOME: homeDir, PCBP_WS_PORT: '0', PCBP_RPC_PORT: '0' } as NodeJS.ProcessEnv;
	const logs: string[] = [];
	try {
		const code = await runDoctor({ homeDir, userHome: home, platform: 'linux', env, fix: true, log: s => logs.push(s) });
		expect(existsSync(join(homeDir, 'token'))).toBe(true);
		for (const target of defaultTargets(home))
			expect(existsSync(join(target.dir, 'SKILL.md'))).toBe(true);
		const status = await new DaemonClient({ homeDir, env }).status();
		expect(status.daemonVersion).toBeTruthy();
		expect(logs.join('\n')).toContain('✓ daemon 运行中');
		// 扩展没连仍是硬失败，--fix 不伪造成功
		expect(code).toBe(1);
	}
	finally {
		await new DaemonClient({ homeDir, env }).shutdown();
	}
}, 30000);

it('runDoctor --fix 幂等：已有 token 不被改写', async () => {
	const home = tempDir('pcbp-home-');
	const homeDir = join(home, '.pcb-pilot');
	mkdirSync(homeDir, { recursive: true });
	const token = 'c'.repeat(64);
	writeFileSync(join(homeDir, 'token'), `${token}\n`);
	const env = { PCBP_HOME: homeDir, PCBP_WS_PORT: '0', PCBP_RPC_PORT: '0' } as NodeJS.ProcessEnv;
	try {
		await runDoctor({ homeDir, userHome: home, platform: 'linux', env, fix: true, log: () => {} });
		expect(readFileSync(join(homeDir, 'token'), 'utf8').trim()).toBe(token);
	}
	finally {
		await new DaemonClient({ homeDir, env }).shutdown();
	}
}, 30000);

it('runStatus 无 daemon 时 exit 1', async () => {
	const home = tempDir('pcbp-home-');
	const logs: string[] = [];
	const code = await runStatus({ homeDir: join(home, '.pcb-pilot'), log: s => logs.push(s) });
	expect(code).toBe(1);
	expect(logs.join('\n')).toContain('daemon');
	expect(logs.join('\n')).toContain(join(home, '.pcb-pilot', 'token'));
});

it('runDoctor 在 daemon 未运行时给出 start 建议', async () => {
	const home = tempDir('pcbp-home-');
	const edaDir = tempDir('pcbp-eda-');
	mkdirSync(edaDir, { recursive: true });
	const logs: string[] = [];
	const code = await runDoctor({
		homeDir: join(home, '.pcb-pilot'),
		userHome: home,
		env: { PCBP_EDA_DIR: edaDir } as NodeJS.ProcessEnv,
		log: s => logs.push(s),
	});
	expect(code).toBe(1);
	expect(logs.join('\n')).toContain('pcb-pilot start');
});