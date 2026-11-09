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
		env: { LOCALAPPDATA: tempDir('pcbp-empty-') } as NodeJS.ProcessEnv,
		log: s => logs.push(s),
	});
	expect(code).toBe(1);
	expect(logs.join('\n')).toContain('允许外部交互');
});

it('runStatus 无 daemon 时 exit 1', async () => {
	const home = tempDir('pcbp-home-');
	const logs: string[] = [];
	const code = await runStatus({ homeDir: join(home, '.pcb-pilot'), log: s => logs.push(s) });
	expect(code).toBe(1);
	expect(logs.join('\n')).toContain('daemon');
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