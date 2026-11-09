import type { EdaApi } from '../eda-api';
import type { ActionHandler } from '../dispatcher';
import { blobToBase64 } from './readback';

export function visionActions(eda: EdaApi): Record<string, ActionHandler> {
	return {
		'vision.screenshot': async (params: { tabId?: string }) => {
			const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(params.tabId);
			if (!blob)
				throw new Error('no rendered image in current editor');
			return { result: { imageBase64: await blobToBase64(blob), mimeType: blob.type || 'image/png' } };
		},
	};
}