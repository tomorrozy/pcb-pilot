import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { DaemonClient } from '../daemon/client.js';
import { ACTIONS } from '../protocol/actions.js';
import { ACTION_NAMES } from '../protocol/names.js';

const pkgVersion = '0.1.0';

function textResult(payload: unknown): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function buildMcpServer(client: DaemonClient): McpServer {
	const server = new McpServer({ name: 'pcb-pilot', version: pkgVersion });

	server.registerTool('status', {
		description: 'daemon 与 EDA 扩展连接状态、当前工程',
		inputSchema: {},
	}, async () => {
		try {
			return textResult(await client.status());
		}
		catch (err) {
			return { content: [{ type: 'text', text: String(err) }], isError: true };
		}
	});

	for (const def of Object.values(ACTIONS)) {
		const toolName = def.name.replaceAll('.', '_');
		server.registerTool(toolName, {
			description: `${def.write ? '[写] ' : ''}${def.summary}`,
			inputSchema: def.params as z.AnyZodObject,
		}, (async (args: Record<string, unknown>) => {
			const res = await client.action(def.name, args ?? {});
			if (!res.ok)
				return { content: [{ type: 'text', text: JSON.stringify(res.error) }], isError: true } satisfies CallToolResult;
			const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify({ result: res.result, readback: res.readback }) }];
			if (def.name === ACTION_NAMES.VISION_SCREENSHOT && res.result) {
				const shot = res.result as { imageBase64: string; mimeType: string };
				content.push({ type: 'image', data: shot.imageBase64, mimeType: shot.mimeType });
			}
			return { content } satisfies CallToolResult;
		}) as any);
	}

	return server;
}