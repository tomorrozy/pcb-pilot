import extensionConfig from '../extension.json' with { type: 'json' };

export function activate(): void {}

function toast(message: string): void {
	eda.sys_Dialog.showInformationMessage(message, 'PCB Pilot');
}

export function status(): void {
	toast(`PCB Pilot Bridge v${extensionConfig.version}\n连接状态：待实现`);
}

export function reconnect(): void {
	toast('PCB Pilot Bridge：重连待实现');
}

export function setToken(): void {
	toast('PCB Pilot Bridge：设置 Token 待实现');
}

export function about(): void {
	toast(`PCB Pilot Bridge v${extensionConfig.version}\n让 AI agent 操控嘉立创EDA专业版`);
}