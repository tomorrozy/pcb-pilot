import type { EdaApi } from '../eda-api';
import type { ActionHandler } from '../dispatcher';
import { readback } from './readback';

function layerId(name: string | undefined): EPCB_LayerId {
	const value = EPCB_LayerId[(name ?? 'TOP') as keyof typeof EPCB_LayerId];
	if (typeof value !== 'number')
		throw { code: 'INVALID_PARAMS', message: `invalid layer: ${name}` };
	return value;
}

export function pcbActions(eda: EdaApi): Record<string, ActionHandler> {
	return {
		'pcb.placeComponent': async (params: { device: { libraryUuid: string; uuid: string }; x: number; y: number; rotation?: number; layer?: string }) => {
			const layer = layerId(params.layer) as TPCB_LayersOfComponent;
			const comp = await eda.pcb_PrimitiveComponent.create(params.device, layer, params.x, params.y, params.rotation);
			const id = comp?.getState_PrimitiveId();
			if (!id)
				throw new Error('placeComponent returned no primitive');
			const got = await eda.pcb_PrimitiveComponent.get(id);
			return { result: { primitiveId: id }, readback: await readback(eda, { primitiveId: id, x: got?.getState_X(), y: got?.getState_Y() }) };
		},
		'pcb.moveComponent': async (params: { id: string; x?: number; y?: number; rotation?: number; layer?: string }) => {
			await eda.pcb_PrimitiveComponent.modify(params.id, {
				x: params.x,
				y: params.y,
				rotation: params.rotation,
				layer: params.layer === undefined ? undefined : layerId(params.layer) as TPCB_LayersOfComponent,
			});
			const got = await eda.pcb_PrimitiveComponent.get(params.id);
			return { result: { primitiveId: params.id }, readback: await readback(eda, { primitiveId: params.id, x: got?.getState_X(), y: got?.getState_Y() }) };
		},
		'pcb.track': async (params: { net: string; layer: string; segments: Array<{ startX: number; startY: number; endX: number; endY: number; width?: number }> }) => {
			const layer = layerId(params.layer) as TPCB_LayersOfLine;
			const primitiveIds: Array<string | null> = [];
			for (const seg of params.segments) {
				const line = await eda.pcb_PrimitiveLine.create(params.net, layer, seg.startX, seg.startY, seg.endX, seg.endY, seg.width);
				primitiveIds.push(line?.getState_PrimitiveId() ?? null);
			}
			return { result: { primitiveIds }, readback: await readback(eda, { primitiveIds }) };
		},
		'pcb.via': async (params: { net: string; x: number; y: number; holeDiameter?: number; diameter?: number }) => {
			const via = await eda.pcb_PrimitiveVia.create(params.net, params.x, params.y, params.holeDiameter ?? 0.3, params.diameter ?? 0.6);
			const id = via?.getState_PrimitiveId();
			if (!id)
				throw new Error('via returned no primitive');
			const got = await eda.pcb_PrimitiveVia.get(id);
			return { result: { primitiveId: id }, readback: await readback(eda, { primitiveId: id, x: got?.getState_X(), y: got?.getState_Y() }) };
		},
		'pcb.delete': async (params: { type: 'component' | 'track' | 'via'; ids: string[] }) => {
			if (params.type === 'component')
				await eda.pcb_PrimitiveComponent.delete(params.ids);
			else if (params.type === 'track')
				await eda.pcb_PrimitiveLine.delete(params.ids);
			else
				await eda.pcb_PrimitiveVia.delete(params.ids);
			return { result: { deleted: params.ids }, readback: await readback(eda) };
		},
		'pcb.listComponents': async () => {
			return { result: await eda.pcb_PrimitiveComponent.getAll() };
		},
		'pcb.listNets': async () => {
			return { result: await eda.pcb_Net.getAllNets() };
		},
		'pcb.importChanges': async () => {
			const changed = await eda.pcb_Document.importChanges();
			return { result: { imported: changed }, readback: await readback(eda) };
		},
		'pcb.autoLayout': async () => {
			await eda.pcb_Document.autoLayout();
			return { result: { laidOut: true }, readback: await readback(eda) };
		},
		'pcb.autoRouting': async () => {
			await eda.pcb_Document.autoRouting();
			return { result: { routed: true }, readback: await readback(eda) };
		},
		'pcb.drc': async () => {
			return { result: await eda.pcb_Drc.check(false, false, true) };
		},
		'pcb.getRules': async () => {
			return { result: await eda.pcb_Drc.getCurrentRuleConfiguration() };
		},
		'pcb.save': async () => {
			await eda.pcb_Document.save();
			return { result: { saved: true }, readback: await readback(eda) };
		},
	};
}