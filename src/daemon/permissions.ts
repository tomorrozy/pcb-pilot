import { chmodSync, existsSync, writeFileSync } from 'node:fs';

// 数据目录可以是被用户共享的 0755，敏感文件的可读性由自身权限决定：token 与审计日志统一收紧到 0600
export function restrictToOwner(file: string): void {
	try {
		if (existsSync(file))
			chmodSync(file, 0o600);
		else
			writeFileSync(file, '', { mode: 0o600 });
	}
	catch {
		// Windows 与只读文件系统的权限语义不同，收紧失败不该阻断 daemon
	}
}
