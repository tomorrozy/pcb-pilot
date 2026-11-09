import type { EdaApi } from '../eda-api';
import type { ActionHandler } from '../dispatcher';
import { readback } from './readback';

export function schActions(eda: EdaApi): Record<string, ActionHandler> {
	return {
		'sch.placeComponent': async (params: { device: { libraryUuid: string; uuid: string }; x: number; y: number; rotation?: number; designator?: string }) => {
			const comp = await eda.sch_PrimitiveComponent.create(params.device, params.x, params.y, undefined, params.rotation);
			if (!comp)
				throw new Error('placeComponent returned no primitive');
			const id = comp.getState_PrimitiveId();
			if (params.designator)
				await eda.sch_PrimitiveComponent.modify(id, { designator: params.designator });
			const got = await eda.sch_PrimitiveComponent.get(id);
			return { result: { primitiveId: id }, readback: await readback(eda, { primitiveId: id, x: got?.getState_X(), y: got?.getState_Y(), designator: got?.getState_Designator() }) };
		},
		'sch.createNetFlag': async (params: { identification: 'Power' | 'Ground' | 'AnalogGround' | 'ProtectGround'; net: string; x: number; y: number; rotation?: number }) => {
			const comp = await eda.sch_PrimitiveComponent.createNetFlag(params.identification, params.net, params.x, params.y, params.rotation);
			return { result: { primitiveId: comp?.getState_PrimitiveId() ?? null }, readback: await readback(eda) };
		},
		'sch.createNetPort': async (params: { direction: 'IN' | 'OUT' | 'BI'; net: string; x: number; y: number; rotation?: number }) => {
			const comp = await eda.sch_PrimitiveComponent.createNetPort(params.direction, params.net, params.x, params.y, params.rotation);
			return { result: { primitiveId: comp?.getState_PrimitiveId() ?? null }, readback: await readback(eda) };
		},
		'sch.wire': async (params: { points: Array<[number, number]>; net?: string }) => {
			const wire = await eda.sch_PrimitiveWire.create(params.points, params.net);
			return { result: { primitiveId: wire?.getState_PrimitiveId() ?? null }, readback: await readback(eda) };
		},
		'sch.modifyComponent': async (params: { id: string; x?: number; y?: number; rotation?: number; designator?: string }) => {
			await eda.sch_PrimitiveComponent.modify(params.id, { x: params.x, y: params.y, rotation: params.rotation, designator: params.designator });
			const got = await eda.sch_PrimitiveComponent.get(params.id);
			return { result: { primitiveId: params.id }, readback: await readback(eda, { primitiveId: params.id, x: got?.getState_X(), y: got?.getState_Y(), designator: got?.getState_Designator() }) };
		},
		'sch.delete': async (params: { type: 'component' | 'wire' | 'netFlag' | 'netPort'; ids: string[] }) => {
			if (params.type === 'wire')
				await eda.sch_PrimitiveWire.delete(params.ids);
			else
				await eda.sch_PrimitiveComponent.delete(params.ids);
			return { result: { deleted: params.ids }, readback: await readback(eda) };
		},
		'sch.listComponents': async () => {
			return { result: await eda.sch_PrimitiveComponent.getAll() };
		},
		'sch.listNets': async () => {
			return { result: await eda.sch_Net.getAllNets() };
		},
		'sch.importChanges': async () => {
			const changed = await eda.sch_Document.importChanges();
			return { result: { imported: changed }, readback: await readback(eda) };
		},
		'sch.autoLayout': async () => {
			await eda.sch_Document.autoLayout();
			return { result: { laidOut: true }, readback: await readback(eda) };
		},
		'sch.drc': async () => {
			return { result: await eda.sch_Drc.check(false, false, true) };
		},
		'sch.save': async () => {
			await eda.sch_Document.save();
			return { result: { saved: true }, readback: await readback(eda) };
		},
	};
}