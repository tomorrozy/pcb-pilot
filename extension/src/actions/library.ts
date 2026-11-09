import type { EdaApi } from '../eda-api';
import type { ActionHandler } from '../dispatcher';

export function libraryActions(eda: EdaApi): Record<string, ActionHandler> {
	return {
		'library.searchDevice': async (params: { key: string; itemsOfPage?: number; page?: number }) => {
			const devices = await eda.lib_Device.search(params.key, undefined, undefined, undefined, params.itemsOfPage, params.page);
			return { result: devices };
		},
		'library.getByLcscId': async (params: { lcscId: string }) => {
			const devices = await eda.lib_Device.getByLcscIds([params.lcscId]);
			return { result: devices };
		},
	};
}