import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runDoctor, runStatus } from './commands.js';
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