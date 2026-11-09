import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { restrictToOwner } from './permissions.js';

export interface AuditEntry {
	ts: string;
	id: string;
	action: string;
	params: unknown;
	ok: boolean;
	errorCode?: string;
	durationMs: number;
}

export class AuditLogger {
	constructor(private readonly filePath: string) {
		mkdirSync(dirname(filePath), { recursive: true });
		restrictToOwner(filePath);
	}

	append(entry: AuditEntry): void {
		appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
	}
}