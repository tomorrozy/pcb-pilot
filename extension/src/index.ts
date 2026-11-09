import extensionConfig from '../extension.json' with { type: 'json' };
import { BridgeClient } from './ws-client';

let client: BridgeClient | undefined;
let lastStatus = 'disconnected';

export function activate(): void {
	const url = (eda.sys_Storage.getExtensionUserConfig('pcbPilot.url') as string | undefined) ?? 'ws://127.0.0.1:49630';
	const token = (eda.sys_Storage.getExtensionUserConfig('pcbPilot.token') as string | undefined) ?? '';
	client = new BridgeClient(eda, {
		url,
		token,
		version: extensionConfig.version,
		onStatus: (status) => {
			lastStatus = status;
		},
	});
	client.start();
}

export function status(): void {
	eda.sys_Dialog.showInformationMessage(
		`PCB Pilot Bridge v${extensionConfig.version}\n连接状态：${client?.getStatus() ?? 'not started'}\n最近状态：${lastStatus}`,
		'PCB Pilot',
	);
}

export function reconnect(): void {
	client?.stop();
	client?.start();
	eda.sys_Dialog.showInformationMessage('PCB Pilot：正在重连 daemon…', 'PCB Pilot');
}

export function setToken(): void {
	eda.sys_Dialog.showInputDialog(
		'输入 pcb-pilot 配对 token（见 ~/.pcb-pilot/token，或运行 pcb-pilot status 查看路径）',
		'',
		'PCB Pilot Token',
		'text',
		'',
		{ placeholder: '64 位 hex' },
		(value) => {
			void eda.sys_Storage.setExtensionUserConfig('pcbPilot.token', String(value ?? '').trim()).then(() => {
				client?.stop();
				client?.start();
				eda.sys_Dialog.showInformationMessage('Token 已保存，正在重连 daemon…', 'PCB Pilot');
			});
		},
	);
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		`PCB Pilot Bridge v${extensionConfig.version}\n让 AI agent 操控嘉立创EDA专业版\nhttps://github.com/tomorrozy/pcb-pilot`,
		'PCB Pilot',
	);
}