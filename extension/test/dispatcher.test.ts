import { expect, it, vi } from 'vitest';
import type { EdaApi } from '../src/eda-api';
import { createDispatcher } from '../src/dispatcher';

function stubEda(): EdaApi {
	return {
		dmt_Project: {
			getCurrentProjectInfo: vi.fn().mockResolvedValue({ uuid: 'proj-1', friendlyName: 'demo' }),
			createProject: vi.fn().mockResolvedValue('proj-1'),
			openProject: vi.fn().mockResolvedValue(true),
		},
		lib_Device: {
			search: vi.fn().mockResolvedValue([{ uuid: 'dev-1', name: 'R0402' }]),
			getByLcscIds: vi.fn().mockResolvedValue([{ uuid: 'dev-2', lcscId: 'C25091' }]),
		},
		dmt_EditorControl: {
			openDocument: vi.fn().mockResolvedValue('tab-1'),
			activateDocument: vi.fn().mockResolvedValue(undefined),
			getSplitScreenTree: vi.fn().mockResolvedValue({ tabs: [] }),
			getCurrentRenderedAreaImage: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })),
		},
		sch_Document: { save: vi.fn().mockResolvedValue(undefined) },
		pcb_Document: { save: vi.fn().mockResolvedValue(undefined) },
	} as unknown as EdaApi;
}

it('未知 action → UNKNOWN_ACTION', async () => {
	const dispatch = createDispatcher(stubEda());
	await expect(dispatch('nope', {})).rejects.toMatchObject({ code: 'UNKNOWN_ACTION' });
});

it('library.searchDevice 透传 key 并返回器件列表', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	const out = await dispatch('library.searchDevice', { key: 'R0402' });
	expect(eda.lib_Device.search).toHaveBeenCalledWith('R0402', undefined, undefined, undefined, undefined, undefined);
	expect(out.result).toEqual([{ uuid: 'dev-1', name: 'R0402' }]);
});

it('project.create 离线参数不含 teamUuid', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	await dispatch('project.create', { friendlyName: 'demo', projectName: 'demo' });
	const args = (eda.dmt_Project.createProject as ReturnType<typeof vi.fn>).mock.calls[0];
	expect(args[0]).toBe('demo');
	expect(args[2]).toBeUndefined();
});

it('API 抛错 → EDA_API_ERROR', async () => {
	const eda = stubEda();
	(eda.dmt_Project.getCurrentProjectInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'));
	const dispatch = createDispatcher(eda);
	await expect(dispatch('project.getStatus', {})).rejects.toMatchObject({ code: 'EDA_API_ERROR', message: 'Error: db error' });
});

it('写动作 readback 附 projectUuid', async () => {
	const dispatch = createDispatcher(stubEda());
	const out = await dispatch('project.create', { friendlyName: 'demo' });
	expect(out.readback).toEqual({ projectUuid: 'proj-1' });
});

it('vision.screenshot 返回 base64 png', async () => {
	const dispatch = createDispatcher(stubEda());
	const out = await dispatch('vision.screenshot', {});
	const r = out.result as { imageBase64: string; mimeType: string };
	expect(r.mimeType).toBe('image/png');
	expect(typeof r.imageBase64).toBe('string');
	expect(r.imageBase64.length).toBeGreaterThan(0);
});