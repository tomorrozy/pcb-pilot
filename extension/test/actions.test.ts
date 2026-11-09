import { beforeAll, expect, it, vi } from 'vitest';
import type { EdaApi } from '../src/eda-api';
import { createDispatcher } from '../src/dispatcher';

beforeAll(() => {
	(globalThis as any).EPCB_LayerId = {
		TOP: 1,
		BOTTOM: 2,
		TOP_SILKSCREEN: 3,
		BOTTOM_SILKSCREEN: 4,
		INNER_1: 15,
		INNER_2: 16,
		INNER_3: 17,
		INNER_4: 18,
		MULTI: 12,
	};
});

function stubEda() {
	const eda = {
		dmt_Project: {
			getCurrentProjectInfo: vi.fn().mockResolvedValue({ uuid: 'proj-1' }),
		},
		sch_PrimitiveComponent: {
			create: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'c1' }),
			get: vi.fn().mockResolvedValue({ getState_X: () => 10, getState_Y: () => 20, getState_Designator: () => 'R1' }),
			modify: vi.fn().mockResolvedValue(true),
			delete: vi.fn().mockResolvedValue(true),
			getAll: vi.fn().mockResolvedValue([{ getState_PrimitiveId: () => 'c1' }]),
			createNetFlag: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'nf1' }),
			createNetPort: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'np1' }),
		},
		sch_PrimitiveWire: {
			create: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'w1' }),
			delete: vi.fn().mockResolvedValue(true),
			get: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'w1' }),
			getAll: vi.fn().mockResolvedValue([{ getState_PrimitiveId: () => 'w1' }]),
		},
		sch_Net: {
			getAllNets: vi.fn().mockResolvedValue([{ name: 'GND' }, { name: 'VCC' }]),
		},
		sch_Drc: {
			check: vi.fn().mockResolvedValue({ errors: [] }),
		},
		sch_Document: {
			importChanges: vi.fn().mockResolvedValue(true),
			autoLayout: vi.fn().mockResolvedValue(undefined),
			save: vi.fn().mockResolvedValue(undefined),
		},
		pcb_PrimitiveComponent: {
			create: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'pc1' }),
			modify: vi.fn().mockResolvedValue(true),
			get: vi.fn().mockResolvedValue({ getState_X: () => 55, getState_Y: () => 66 }),
			delete: vi.fn().mockResolvedValue(true),
			getAll: vi.fn().mockResolvedValue([{ getState_PrimitiveId: () => 'pc1' }]),
		},
		pcb_PrimitiveLine: {
			create: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'tr1' }),
			delete: vi.fn().mockResolvedValue(true),
			getAll: vi.fn().mockResolvedValue([]),
		},
		pcb_PrimitiveVia: {
			create: vi.fn().mockResolvedValue({ getState_PrimitiveId: () => 'via1' }),
			get: vi.fn().mockResolvedValue({ getState_X: () => 7, getState_Y: () => 8 }),
			delete: vi.fn().mockResolvedValue(true),
			getAll: vi.fn().mockResolvedValue([]),
		},
		pcb_Net: {
			getAllNets: vi.fn().mockResolvedValue([{ name: 'GND' }]),
		},
		pcb_Drc: {
			check: vi.fn().mockResolvedValue({ errors: [] }),
			getCurrentRuleConfiguration: vi.fn().mockResolvedValue({ clearance: 0.2 }),
		},
		pcb_Document: {
			importChanges: vi.fn().mockResolvedValue(true),
			autoLayout: vi.fn().mockResolvedValue(undefined),
			autoRouting: vi.fn().mockResolvedValue(undefined),
			save: vi.fn().mockResolvedValue(undefined),
		},
		pcb_ManufactureData: {
			getGerberFile: vi.fn().mockResolvedValue(new File(['zip-bytes'], 'gerber.zip', { type: 'application/zip' })),
			getBomFile: vi.fn().mockResolvedValue(new File(['bom'], 'bom.csv', { type: 'text/csv' })),
			getPickAndPlaceFile: vi.fn().mockResolvedValue(new File(['pp'], 'pick_and_place.csv')),
			getNetlistFile: vi.fn().mockResolvedValue(new File(['net'], 'netlist.net')),
			getPdfFile: vi.fn().mockResolvedValue(new File(['pdf'], 'schematic.pdf')),
		},
	};
	return eda as unknown as EdaApi & Record<string, any>;
}

it('sch.placeComponent 调 create 并读回坐标/位号/projectUuid', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	const out = await dispatch('sch.placeComponent', { device: { libraryUuid: 'lib-1', uuid: 'dev-1' }, x: 10, y: 20, designator: 'R1' });
	expect(eda.sch_PrimitiveComponent.create).toHaveBeenCalled();
	expect((eda.sch_PrimitiveComponent.create as any).mock.calls[0][0]).toEqual({ libraryUuid: 'lib-1', uuid: 'dev-1' });
	expect(eda.sch_PrimitiveComponent.modify).toHaveBeenCalledWith('c1', { designator: 'R1' });
	expect(out.readback).toMatchObject({ projectUuid: 'proj-1', primitiveId: 'c1', x: 10, y: 20, designator: 'R1' });
});

it('sch.wire 返回 net 与图元 id', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	const out = await dispatch('sch.wire', { points: [[0, 0], [5, 5]], net: 'GND' });
	expect((eda.sch_PrimitiveWire.create as any).mock.calls[0][1]).toBe('GND');
	expect(out.result).toMatchObject({ primitiveId: 'w1' });
});

it('sch.delete 按类型分发到 component/wire', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	await dispatch('sch.delete', { type: 'wire', ids: ['w1'] });
	expect(eda.sch_PrimitiveWire.delete).toHaveBeenCalledWith(['w1']);
	await dispatch('sch.delete', { type: 'component', ids: ['c1'] });
	expect(eda.sch_PrimitiveComponent.delete).toHaveBeenCalledWith(['c1']);
});

it('pcb.track 逐段 create，非法 layer → INVALID_PARAMS', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	await dispatch('pcb.track', { net: 'GND', layer: 'TOP', segments: [
		{ startX: 0, startY: 0, endX: 5, endY: 0, width: 0.25 },
		{ startX: 5, startY: 0, endX: 5, endY: 5 },
	] });
	expect((eda.pcb_PrimitiveLine.create as any).mock.calls).toHaveLength(2);
	expect((eda.pcb_PrimitiveLine.create as any).mock.calls[0][0]).toBe('GND');
	expect((eda.pcb_PrimitiveLine.create as any).mock.calls[0][1]).toBe(1);
	await expect(dispatch('pcb.track', { net: 'GND', layer: 'NOPE', segments: [{ startX: 0, startY: 0, endX: 1, endY: 1 }] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
});

it('pcb.drc 与 sch.drc 调 check(false,false,true)', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	await dispatch('pcb.drc', {});
	expect(eda.pcb_Drc.check).toHaveBeenCalledWith(false, false, true);
	await dispatch('sch.drc', {});
	expect(eda.sch_Drc.check).toHaveBeenCalledWith(false, false, true);
});

it('pcb.placeComponent/via readback 来自重新读取', async () => {
	const eda = stubEda();
	const dispatch = createDispatcher(eda);
	const placed = await dispatch('pcb.placeComponent', { device: { libraryUuid: 'l', uuid: 'd' }, x: 1, y: 2 });
	expect(placed.readback).toMatchObject({ x: 55, y: 66 });
	const via = await dispatch('pcb.via', { net: 'GND', x: 1, y: 2 });
	expect(via.readback).toMatchObject({ x: 7, y: 8 });
});

it('output.gerber 返回 fileName/base64/sizeBytes', async () => {
	const dispatch = createDispatcher(stubEda());
	const out = await dispatch('output.gerber', {});
	const r = out.result as { fileName: string; base64: string; sizeBytes: number };
	expect(r.fileName).toBe('gerber.zip');
	expect(Buffer.from(r.base64, 'base64').toString()).toBe('zip-bytes');
	expect(r.sizeBytes).toBe(9);
});