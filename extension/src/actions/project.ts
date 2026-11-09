import type { EdaApi } from '../eda-api';
import type { ActionHandler } from '../dispatcher';
import { readback } from './readback';

export function projectActions(eda: EdaApi): Record<string, ActionHandler> {
	return {
		'project.getStatus': async () => {
			const info = await eda.dmt_Project.getCurrentProjectInfo();
			return { result: info ?? null };
		},
		'project.create': async (params: { friendlyName: string; projectName?: string; description?: string }) => {
			const uuid = await eda.dmt_Project.createProject(params.friendlyName, params.projectName, undefined, undefined, params.description);
			return { result: { projectUuid: uuid ?? null }, readback: await readback(eda, { projectUuid: uuid }) };
		},
		'project.open': async (params: { projectUuid: string }) => {
			const opened = await eda.dmt_Project.openProject(params.projectUuid);
			return { result: { opened }, readback: await readback(eda) };
		},
		'project.save': async () => {
			await eda.sch_Document.save().catch(() => {});
			await eda.pcb_Document.save().catch(() => {});
			return { result: { saved: true }, readback: await readback(eda) };
		},
		'editor.openDocument': async (params: { documentUuid: string }) => {
			const tabId = await eda.dmt_EditorControl.openDocument(params.documentUuid);
			return { result: { tabId: tabId ?? null } };
		},
		'editor.activateDocument': async (params: { tabId: string }) => {
			await eda.dmt_EditorControl.activateDocument(params.tabId);
			return { result: { activated: true } };
		},
		'editor.listTabs': async () => {
			const tree = await eda.dmt_EditorControl.getSplitScreenTree();
			return { result: tree ?? null };
		},
	};
}