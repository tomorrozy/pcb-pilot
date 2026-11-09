import { expect, it } from 'vitest';
import { ACTIONS, getActionDef, parseBridgeMessage } from './index.js';

it('parseBridgeMessage 拒绝垃圾输入不抛异常', () => {
	expect(parseBridgeMessage('not json')).toBeUndefined();
	expect(parseBridgeMessage('{"type":"bogus"}')).toBeUndefined();
	expect(parseBridgeMessage('null')).toBeUndefined();
});

it('合法 action 帧往返', () => {
	const f = { type: 'action', id: '1', action: 'sch.wire', params: { points: [[0, 0], [1, 1]] } };
	expect(parseBridgeMessage(JSON.stringify(f))).toEqual(f);
});

it('40 个动作全部注册且写动作带 readback 语义', () => {
	expect(Object.keys(ACTIONS)).toHaveLength(40);
	expect(getActionDef('sch.placeComponent')!.write).toBe(true);
	expect(getActionDef('sch.listNets')!.write).toBe(false);
	expect(getActionDef('nope')).toBeUndefined();
});

it('sch.wire 参数校验', () => {
	const def = getActionDef('sch.wire')!;
	expect(def.params.safeParse({ points: [[0, 0], [5, 5]], net: 'GND' }).success).toBe(true);
	expect(def.params.safeParse({ points: [[0, 0]] }).success).toBe(false);
});

it('超时分级', () => {
	expect(getActionDef('pcb.autoRouting')!.timeoutMs).toBe(180000);
	expect(getActionDef('output.gerber')!.timeoutMs).toBe(120000);
	expect(getActionDef('sch.listNets')!.timeoutMs).toBe(30000);
});