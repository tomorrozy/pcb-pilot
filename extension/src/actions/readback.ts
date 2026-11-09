import type { EdaApi } from '../eda-api';

export async function projectUuid(eda: EdaApi): Promise<string | undefined> {
	const info = await eda.dmt_Project.getCurrentProjectInfo();
	return info?.uuid;
}

export async function readback(eda: EdaApi, extra?: Record<string, unknown>): Promise<{ projectUuid?: string } & Record<string, unknown>> {
	return { projectUuid: await projectUuid(eda), ...extra };
}

export async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}