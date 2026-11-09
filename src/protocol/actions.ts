import { z } from 'zod';
import type { ActionName } from './names.js';

export const DEFAULT_TIMEOUT_MS = 30000;
export const LONG_TIMEOUT_MS = 180000;
export const OUTPUT_TIMEOUT_MS = 120000;

export interface ActionDef {
	name: ActionName;
	summary: string;
	params: z.ZodTypeAny;
	write: boolean;
	timeoutMs: number;
}

const empty = z.object({});
const deviceRef = z.object({ libraryUuid: z.string(), uuid: z.string() });
const fileName = z.object({ fileName: z.string().optional() });

function def(name: ActionName, summary: string, params: z.ZodTypeAny, write: boolean, timeoutMs: number = DEFAULT_TIMEOUT_MS): ActionDef {
	return { name, summary, params, write, timeoutMs };
}

export const ACTIONS: Record<ActionName, ActionDef> = {
	'project.getStatus': def('project.getStatus', '当前工程与连接状态', empty, false),
	'project.create': def('project.create', '创建本地工程（离线模式）', z.object({ friendlyName: z.string(), projectName: z.string().optional(), description: z.string().optional() }), true),
	'project.open': def('project.open', '打开工程', z.object({ projectUuid: z.string() }), false),
	'project.save': def('project.save', '保存当前文档', empty, true),
	'editor.openDocument': def('editor.openDocument', '在编辑器打开文档', z.object({ documentUuid: z.string() }), false),
	'editor.activateDocument': def('editor.activateDocument', '激活文档标签页', z.object({ tabId: z.string() }), false),
	'editor.listTabs': def('editor.listTabs', '列出编辑器标签页', empty, false),
	'library.searchDevice': def('library.searchDevice', '按关键词搜索器件库', z.object({ key: z.string(), itemsOfPage: z.number().optional(), page: z.number().optional() }), false),
	'library.getByLcscId': def('library.getByLcscId', '按立创编号(C开头)取器件', z.object({ lcscId: z.string() }), false),
	'sch.placeComponent': def('sch.placeComponent', '原理图放置器件', z.object({ device: deviceRef, x: z.number(), y: z.number(), rotation: z.number().optional(), designator: z.string().optional() }), true),
	'sch.createNetFlag': def('sch.createNetFlag', '放置电源/地网络标号', z.object({ identification: z.enum(['Power', 'Ground', 'AnalogGround', 'ProtectGround']), net: z.string(), x: z.number(), y: z.number(), rotation: z.number().optional() }), true),
	'sch.createNetPort': def('sch.createNetPort', '放置网络端口', z.object({ direction: z.enum(['IN', 'OUT', 'BI']), net: z.string(), x: z.number(), y: z.number(), rotation: z.number().optional() }), true),
	'sch.wire': def('sch.wire', '原理图连线', z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(2), net: z.string().optional() }), true),
	'sch.modifyComponent': def('sch.modifyComponent', '修改原理图器件属性/坐标', z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(), designator: z.string().optional() }), true),
	'sch.delete': def('sch.delete', '删除原理图图元', z.object({ type: z.enum(['component', 'wire', 'netFlag', 'netPort']), ids: z.array(z.string()).min(1) }), true),
	'sch.listComponents': def('sch.listComponents', '列出原理图全部器件', empty, false),
	'sch.listNets': def('sch.listNets', '列出原理图全部网络', empty, false),
	'sch.importChanges': def('sch.importChanges', '原理图导入变更', empty, true),
	'sch.autoLayout': def('sch.autoLayout', '原理图自动布局', empty, true, LONG_TIMEOUT_MS),
	'sch.drc': def('sch.drc', '原理图 DRC 检查', empty, false),
	'sch.save': def('sch.save', '保存原理图', empty, true),
	'pcb.placeComponent': def('pcb.placeComponent', 'PCB 放置器件封装', z.object({ device: deviceRef, x: z.number(), y: z.number(), rotation: z.number().optional(), layer: z.string().optional() }), true),
	'pcb.moveComponent': def('pcb.moveComponent', '移动 PCB 器件', z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), rotation: z.number().optional(), layer: z.string().optional() }), true),
	'pcb.track': def('pcb.track', 'PCB 走线', z.object({ net: z.string(), layer: z.string(), segments: z.array(z.object({ startX: z.number(), startY: z.number(), endX: z.number(), endY: z.number(), width: z.number().optional() })).min(1) }), true),
	'pcb.via': def('pcb.via', '放置过孔', z.object({ net: z.string(), x: z.number(), y: z.number(), holeDiameter: z.number().optional(), diameter: z.number().optional() }), true),
	'pcb.delete': def('pcb.delete', '删除 PCB 图元', z.object({ type: z.enum(['component', 'track', 'via']), ids: z.array(z.string()).min(1) }), true),
	'pcb.listComponents': def('pcb.listComponents', '列出 PCB 全部器件', empty, false),
	'pcb.listNets': def('pcb.listNets', '列出 PCB 全部网络', empty, false),
	'pcb.importChanges': def('pcb.importChanges', '从原理图导入变更到 PCB', empty, true),
	'pcb.autoLayout': def('pcb.autoLayout', 'PCB 自动布局', empty, true, LONG_TIMEOUT_MS),
	'pcb.autoRouting': def('pcb.autoRouting', 'PCB 自动布线', empty, true, LONG_TIMEOUT_MS),
	'pcb.drc': def('pcb.drc', 'PCB DRC 检查', empty, false),
	'pcb.getRules': def('pcb.getRules', '读取当前 PCB 设计规则', empty, false),
	'pcb.save': def('pcb.save', '保存 PCB', empty, true),
	'output.gerber': def('output.gerber', '导出 Gerber 制造文件', fileName, false, OUTPUT_TIMEOUT_MS),
	'output.bom': def('output.bom', '导出 BOM 表', fileName, false, OUTPUT_TIMEOUT_MS),
	'output.pickAndPlace': def('output.pickAndPlace', '导出坐标文件', fileName, false, OUTPUT_TIMEOUT_MS),
	'output.netlist': def('output.netlist', '导出网表', fileName, false, OUTPUT_TIMEOUT_MS),
	'output.pdf': def('output.pdf', '导出 PDF', fileName, false, OUTPUT_TIMEOUT_MS),
	'vision.screenshot': def('vision.screenshot', '编辑器当前区域截图(base64)', z.object({ tabId: z.string().optional() }), false),
};

export function getActionDef(name: string): ActionDef | undefined {
	return Object.hasOwn(ACTIONS, name) ? ACTIONS[name as ActionName] : undefined;
}