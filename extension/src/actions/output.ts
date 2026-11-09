import type { EdaApi } from '../eda-api';
import type { ActionHandler } from '../dispatcher';
import { bytesToBase64 } from './readback';

async function fileResult(file: File | undefined, fallbackName: string): Promise<{ result: { fileName: string; base64: string; sizeBytes: number } }> {
	if (!file)
		throw new Error('manufacture API returned no file');
	const bytes = new Uint8Array(await file.arrayBuffer());
	return { result: { fileName: file.name || fallbackName, base64: bytesToBase64(bytes), sizeBytes: bytes.byteLength } };
}

export function outputActions(eda: EdaApi): Record<string, ActionHandler> {
	return {
		'output.gerber': async (params: { fileName?: string }) => {
			return fileResult(await eda.pcb_ManufactureData.getGerberFile(params.fileName), 'gerber.zip');
		},
		'output.bom': async (params: { fileName?: string }) => {
			return fileResult(await eda.pcb_ManufactureData.getBomFile(params.fileName), 'bom.csv');
		},
		'output.pickAndPlace': async (params: { fileName?: string }) => {
			return fileResult(await eda.pcb_ManufactureData.getPickAndPlaceFile(params.fileName), 'pick_and_place.csv');
		},
		'output.netlist': async (params: { fileName?: string }) => {
			return fileResult(await eda.pcb_ManufactureData.getNetlistFile(params.fileName), 'netlist.net');
		},
		'output.pdf': async (params: { fileName?: string }) => {
			return fileResult(await eda.pcb_ManufactureData.getPdfFile(params.fileName), 'schematic.pdf');
		},
	};
}