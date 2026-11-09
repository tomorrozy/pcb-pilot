import type { EdaApi } from './eda-api';
import { libraryActions } from './actions/library';
import { outputActions } from './actions/output';
import { pcbActions } from './actions/pcb';
import { projectActions } from './actions/project';
import { schActions } from './actions/sch';
import { visionActions } from './actions/vision';

export type ActionHandler = (params: any) => Promise<{ result: unknown; readback?: unknown }>;

export interface ActionFailure {
	code: string;
	message: string;
}

export function createDispatcher(eda: EdaApi): (action: string, params: any) => Promise<{ result: unknown; readback?: unknown }> {
	const handlers: Record<string, ActionHandler> = {
		...projectActions(eda),
		...libraryActions(eda),
		...visionActions(eda),
		...schActions(eda),
		...pcbActions(eda),
		...outputActions(eda),
	};
	return async (action: string, params: any) => {
		const handler = handlers[action];
		if (!handler)
			throw { code: 'UNKNOWN_ACTION', message: `unknown action: ${action}` } satisfies ActionFailure;
		try {
			return await handler(params);
		}
		catch (err) {
			if (err && typeof err === 'object' && 'code' in err)
				throw err;
			throw { code: 'EDA_API_ERROR', message: String(err) } satisfies ActionFailure;
		}
	};
}