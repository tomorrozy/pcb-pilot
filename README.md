# pcb-pilot

让 AI agent 直接操控**嘉立创EDA专业版（EasyEDA Pro）**画原理图和 PCB。

给 Claude Code / Codex / DeepSeek Harness / Qoder 等 agent 装上一双「画板的手」：通过 MCP 调用 typed action，真实地建工程、搜立创商城器件、放件、连线、布局布线、跑 DRC、导出 Gerber/BOM。

> 仅支持**专业版桌面客户端**（标准版/网页版没有扩展 API）。面向**离线/本地工程模式**。daemon / CLI / MCP 支持 **Windows、macOS、Linux**（CI 三平台跑通）；EDA 真机联调目前只在 Windows 上做，macOS/Linux 请按 `docs/platforms.md` 自行验证。

## 架构

```
┌─────────────┐   MCP (stdio)   ┌──────────┐   loopback HTTP   ┌──────────┐   WebSocket    ┌──────────────────┐
│ Claude Code │◄───────────────►│ pcb-pilot│◄─────────────────►│  daemon  │◄──────────────►│ EDA .eext 桥接扩展│
│ Codex / DSH │                 │  mcp     │                   │          │                │ (eda.* 官方 API) │
│ Qoder       │                 └──────────┘                   └────┬─────┘                └──────────────────┘
└─────────────┘                                                     │
                                                  ~/.pcb-pilot/{token, audit.jsonl, output/}
```

- **daemon**：独占 WS 端口（默认 49630）+ 本机 RPC（49631），动作**串行**执行，写审计日志。
- **MCP 适配器**：40 个动作 + `status` 工具，stdio 接入任意 MCP 客户端。
- **.eext 扩展**：在 EDA 内运行，用官方 `eda.*` API 执行动作，写动作回传 readback。
- **Skill**：告诉 agent 怎么读工程、选器件、画图、自检、出制造文件。

## 5 分钟上手

```bash
# 0. 平台特有的客户端准备（macOS Gatekeeper、Linux 无固定安装目录）见 docs/platforms.md

# 1. 安装 CLI（Node >= 20.17）
npm i -g pcb-pilot

# 2. 安装 Agent Skill，并打印 MCP 注册命令
pcb-pilot install

# 3. 在 agent 客户端注册 MCP（按 install 输出执行），例如：
claude mcp add pcb-pilot -- npx -y pcb-pilot mcp
# 或
codex mcp add pcb-pilot -- npx -y pcb-pilot mcp

# 4. 启动 daemon 并查看配对 token 路径
pcb-pilot start
pcb-pilot status

# 5. 在嘉立创EDA专业版里：
#    a. 扩展管理器安装 GitHub Release 里的 pcb-pilot-bridge_v*.eext 并启用
#    b. 打开「允许外部交互」
#    c. 打开一个原理图/PCB 文档
#    d. 菜单 PCB Pilot → 设置 Token，粘贴第 4 步显示的 token
#    e. 菜单 PCB Pilot → 重连

# 6. 自检全绿
pcb-pilot doctor
```

然后在 agent 里说话：

> 帮我建一个新工程，用 ESP32-C3 + AMS1117-3.3 做一个温湿度传感器板：I2C 接 SHT30，板载 WS2812 指示灯，按 2.54mm 网格画原理图并做 DRC。

Agent 会按 Skill 的工作流读现状、搜库选型、放件、连线、读回校验、导入 PCB、布局布线、DRC、导出制造文件。

## 客户端注册

| 客户端 | 方式 |
|---|---|
| Claude Code | `claude mcp add pcb-pilot -- npx -y pcb-pilot mcp` |
| Codex | `codex mcp add pcb-pilot -- npx -y pcb-pilot mcp` |
| Claude Desktop / Cursor | `{"mcpServers":{"pcb-pilot":{"command":"npx","args":["-y","pcb-pilot","mcp"]}}}` |
| DeepSeek Harness | 将 `skill/` 放入其插件/skill 目录，MCP 注册同上 |
| Qoder | Skill 已装到 `~/.agents/skills/pcb-pilot`，MCP 按通用 JSON 配置 |

多个客户端可以同时连接同一个 daemon；agent 重启不会断开 EDA 桥。

## 离线/本地工程模式

v1 面向离线/本地工程：`project.create` 不依赖云端 team，工程落在本地。器件库搜索能力受客户端离线模式限制——搜索不到时 Skill 会提示用户，而不是臆造器件。

## 平台说明

| 平台 | 代码 + CI | EDA 真机 |
|---|---|---|
| Windows | ✅ | ⏳ 待跑冒烟清单 |
| macOS（11+） | ✅ | ⬜ 未验证 |
| Linux（4.9+，x64/arm64） | ✅ | ⬜ 未验证 |

三平台共用一个数据目录 `~/.pcb-pilot/`（token `0600`、目录 `0700`），daemon 端口 `127.0.0.1:49630/49631`。EDA 客户端位置按 `PCBP_EDA_DIR` → 各平台默认目录 → PATH 里的 `lceda-pro` 顺序探测；探不到只算提示（`!`），不会让 `doctor` 判失败——扩展连上 daemon 才是可用信号。细节（Gatekeeper 放行、Linux zip 解压即用、切换在线/离线模式后需重新导入 .eext）见 [`docs/platforms.md`](docs/platforms.md)。

## 安全模型

- 所有监听只绑 `127.0.0.1`，不外网。
- 扩展连接需要配对 token（`~/.pcb-pilot/token`，首次启动自动生成）。
- **没有任意 JS 执行通道**：只有白名单 typed action，协议层 zod 校验。
- 写动作必须带 readback（含 `projectUuid`）；工程中途切换会返回 `READBACK_MISMATCH` 并停止写入。
- 所有动作写审计日志 `~/.pcb-pilot/audit.jsonl`。
- 制造文件落盘到 `~/.pcb-pilot/output/`，文件名做了目录穿越防护。

## 开发

```bash
npm install
npm run build && npm test          # daemon / MCP / CLI / 协议
npm install --prefix extension
npm test --prefix extension        # 扩展 dispatcher / ws-client（stub eda）
npm run build --prefix extension   # 产出 extension/build/dist/*.eext（需 Node >= 24）
```

真机联调清单见 `docs/smoke-test.md`。

## 商标与许可

- 本项目使用 Apache-2.0 许可。`extension/` 内构建脚本 vendor 自 [easyeda/pro-api-sdk](https://github.com/easyeda/pro-api-sdk)（Apache-2.0），已保留来源注释。
- 「嘉立创EDA」「EasyEDA」为嘉立创科技集团股份有限公司商标，本项目与官方无隶属关系，商标仅用于描述兼容性。
- 本项目不会代替你下单；Gerber/BOM 请自行核对后再送厂。

## 路线图

- [x] macOS / Linux 支持（代码、探测、权限、CI 已完成；EDA 真机验证待用户/社区按 `docs/platforms.md` 反馈）
- [ ] 多 EDA 实例
- [ ] 铺铜编辑、差分对/等长规则动作
- [ ] 官方扩展商店上架
