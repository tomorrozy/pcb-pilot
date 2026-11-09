import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DaemonClient } from '../daemon/client.js';
import { buildMcpServer } from './server.js';

export async function runMcpServer(): Promise<void> {
	const client = new DaemonClient();
	const status = await client.ensureDaemon();
	const server = buildMcpServer(client);
	await server.connect(new StdioServerTransport());
	console.error(`pcb-pilot MCP ready (daemon pid ${status.pid}, EDA ${status.extensionConnected ? 'connected' : 'not connected'})`);
}