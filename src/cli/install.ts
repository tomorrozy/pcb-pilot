import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillTarget {
	name: string;
	dir: string;
}

export function defaultTargets(homeDir: string): SkillTarget[] {
	return [
		{ name: 'Claude Code', dir: join(homeDir, '.claude', 'skills', 'pcb-pilot') },
		{ name: 'Codex', dir: join(homeDir, '.codex', 'skills', 'pcb-pilot') },
		{ name: 'Qoder / generic agents', dir: join(homeDir, '.agents', 'skills', 'pcb-pilot') },
	];
}

export function installSkill(opts: { homeDir: string; skillSrc: string; targets?: SkillTarget[] }): { installed: string[] } {
	if (!existsSync(opts.skillSrc))
		throw new Error(`skill source not found: ${opts.skillSrc}`);
	const targets = opts.targets ?? defaultTargets(opts.homeDir);
	const installed: string[] = [];
	for (const target of targets) {
		mkdirSync(join(target.dir, '..'), { recursive: true });
		cpSync(opts.skillSrc, target.dir, { recursive: true, force: true });
		installed.push(target.dir);
	}
	return { installed };
}

export function registrationSnippets(): string {
	return [
		'在 agent 客户端注册 MCP（任选其一，二选一即可）：',
		'',
		'  Claude Code:',
		'    claude mcp add pcb-pilot -- npx -y pcb-pilot mcp',
		'',
		'  Codex:',
		'    codex mcp add pcb-pilot -- npx -y pcb-pilot mcp',
		'',
		'  Claude Desktop / Cursor（JSON 配置）:',
		'    {',
		'      "mcpServers": {',
		'        "pcb-pilot": { "command": "npx", "args": ["-y", "pcb-pilot", "mcp"] }',
		'      }',
		'    }',
		'',
		'  DeepSeek Harness: 将 skill/ 目录内容放入其插件/skill 目录，MCP 注册同上。',
	].join('\n');
}