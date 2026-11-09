import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DaemonClient } from '../../src/daemon/client.js';
import { startDaemon } from '../../src/daemon/main.js';
import { buildMcpServer } from '../../src/mcp/server.js';
import { MockEdaClient } from '../mock-eda.js';

let homeDir: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;
let client: Client;
let mock: MockEdaClient;

beforeAll(async () => {
	homeDir = mkdtempSync(join(tmpdir(), 'pcbp-mcp-'));
	daemon = await startDaemon({ homeDir, env: { PCBP_WS_PORT: '0', PCBP_RPC_PORT: '0' } as NodeJS.ProcessEnv });
	const status = await new DaemonClient({ homeDir }).status();
	const token = readFileSync(join(homeDir, 'token'), 'utf8').trim();
	mock = new MockEdaClient(`ws://127.0.0.1:${status.wsPort}`, token);
	await mock.connect();
	const mcp = buildMcpServer(new DaemonClient({ homeDir }));
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await mcp.connect(serverTransport);
	client = new Client({ name: 'test-client', version: '0.0.0' });
	await client.connect(clientTransport);
});

afterAll(async () => {
	mock.close();
	await daemon.stop();
});

it('listTools 含 41 个工具且 sch_placeComponent 在列', async () => {
	const tools = await client.listTools();
	expect(tools.tools).toHaveLength(41);
	const names = tools.tools.map(t => t.name);
	expect(names).toContain('sch_placeComponent');
	expect(names).toContain('pcb_autoRouting');
	expect(names).toContain('status');
	const writeTool = tools.tools.find(t => t.name === 'sch_wire')!;
	expect(writeTool.description?.startsWith('[写]')).toBe(true);
});

it('callTool sch_listNets 返回 mock 结果', async () => {
	const res = await client.callTool({ name: 'sch_listNets', arguments: {} });
	const content = res.content as Array<{ type: string; text: string }>;
	expect(content[0].type).toBe('text');
	expect(JSON.parse(content[0].text)).toEqual({ result: { echo: true } });
});

it('callTool 非法参数 → isError（MCP 层 zod 校验拦截）', async () => {
	const res = await client.callTool({ name: 'sch_wire', arguments: { points: [[0, 0]] } });
	expect(res.isError).toBe(true);
	const content = res.content as Array<{ type: string; text: string }>;
	expect(content[0].text.length).toBeGreaterThan(0);
});

it('status 工具返回 extensionConnected:true', async () => {
	const res = await client.callTool({ name: 'status', arguments: {} });
	const content = res.content as Array<{ type: string; text: string }>;
	expect(JSON.parse(content[0].text).extensionConnected).toBe(true);
});