# pcb-pilot 设计文档

日期：2026-11-09
状态：待批准

## 意图与动机

让任何支持 MCP 或 Agent Skill 的 coding agent（Claude Code、Codex、DeepSeek Harness、Qoder 等）通过自然语言直接驱动**嘉立创 EDA 专业版桌面客户端**完成真实电路设计：建工程、搜立创商城器件、画原理图、连线、导入 PCB、布局布线、DRC 检查、导出 Gerber/BOM。

发布为一个独立 GitHub 仓库，用户一条命令安装后即可让自己的 agent「长出手」。

为什么了自研而不是用现成方案：用户明确要求创造一个自己的封装包（可署名、可参赛、代码完全可控）。调研确认官方 `easyeda-api-skill` 偏重文档检索桥接，社区 `easyeda-agent` 为 Go 实现且形态固定；自研可以在架构简洁性、typed 协议安全性、多客户端接入上做自己的取舍。

## 目标

- G1：单仓四件套——`.eext` 桥接扩展、本地 daemon、stdio MCP 适配器、Agent Skill，外加一个统一 CLI。
- G2：typed action 协议（JSON 请求/响应），**不暴露任意 JS 执行**；每个写动作返回读回校验数据（readback）。
- G3：多个 agent 客户端可同时连接同一个 EDA 实例；agent 重启不需要在 EDA 里手动重连。
- G4：v1 动作覆盖——
  - 工程：创建/打开工程、列出文档、切换激活文档、保存；
  - 库：按关键词/立创编号（C 开头 LCSC ID）搜器件；
  - 原理图：放器件、电源/地网络标号、网络端口、连线、修改/删除图元、列出器件与网络、导入变更、自动布局、DRC；
  - PCB：放/移器件、走线、过孔、列出器件与网络、从原理图导入变更、自动布局、自动布线、DRC 与规则读取；
  - 制造输出：Gerber、BOM、坐标文件（pick & place）、网表、PDF；
  - 视觉：编辑器当前区域截图（base64），供 agent 看图校验。
- G5：一条命令安装（`npx pcb-pilot install`）：Skill 装到各客户端目录、打印/执行 MCP 注册、引导安装 .eext。
- G6：GitHub Actions CI：类型检查 + 单测 + 协议集成测试；Release 产出 .eext 与 npm 包。
- G7：文档中文优先（README 中英双语，Skill 中文）。

## 非目标（v1 明确不做）

- 嘉立创 EDA 标准版 / 网页版（无扩展 API，物理上不可行）。
- 任意 JavaScript 执行通道（如 `eda.debug.execJS`）——安全红线。
- 嘉立创账号操作、下单、支付。
- 离线生成/直接改工程文件（绕过官方 API）。
- 承诺复杂板子的全自动布线质量——自动布线用官方算法，agent 负责 DRC 与人工确认。
- 铺铜（pour）编辑若 API 映射复杂可顺延 v1.1，由实现者判断。

## 反目标（即使技术可行也算失败）

- 静默修改用户工程：无读回、无审计日志的写入。
- 桥接端口暴露到局域网或公网。
- 安装过程索要嘉立创账号密码或任何凭据。

## 约束（已核实）

- 仅专业版客户端支持扩展，`extension.json` 要求 `engines.eda: ^3.2.0`；用户需在客户端开启「允许外部交互」。
- 扩展运行在前端沙盒，**只能向外发起 WebSocket**（`eda.sys_WebSocket.register(id, serviceUri, onMessage, onConnected)` + `send(id, data)`），不能监听端口 → 本地 daemon 必须是 WS 服务端。官方 SDK 的 dev 模式（`build/dev.ts`，端口 59394 推送 .eext）已验证此模式可行。
- 官方 SDK：`github.com/easyeda/pro-api-sdk`（Apache-2.0），esbuild 打包 + jszip 生成 `.eext`，Node ≥ 20.17；类型包 `@jlceda/pro-api-types`（当前 0.4.27）。
- 商标约束：嘉立创EDA / EasyEDA 商标仅用于功能描述与开源发布标题。
- 本机已装专业版客户端（`%LOCALAPPDATA%/Programs/lceda-pro`），Node v24。真机联调需用户配合：装 .eext、开外部交互、点重连。
- CI 无法跑真实 EDA → 协议层用 mock EDA WS 客户端做集成测试；真机冒烟由用户按清单执行。

## 候选方案与选定

1. **daemon + 薄适配器（选定）**：本地 daemon 独占 WS 端口（对扩展）并暴露 loopback RPC（对 MCP/CLI）；MCP stdio 进程和 CLI 都是薄客户端。多客户端同时在线、agent 重启不断桥、审计集中。代价是多一层进程管理。
2. 单进程一体式：一个进程同时当 MCP server 和 WS 桥。代码最少，但多客户端抢端口、agent 重启即断桥需手动重连。被否。
3. 纯文件生成：直接生成工程文件让用户打开。无真机读回、格式未公开且脆弱。被否。

## 已决定的架构

- **语言**：TypeScript 全栈。扩展端经官方 SDK 构建链（esbuild）打包；daemon/MCP/CLI 为 npm workspace 单仓多包。理由：官方类型包与 MCP TS SDK 都是 TS，一种语言覆盖全部组件。
- **仓库/包名**：`pcb-pilot`（实现者注：此为设计者定的名字，用户可改；商标合规）。
- **组件与目录**：
  - `extension/`：基于官方 pro-api-sdk 构建链的桥接扩展。激活后 `sys_WebSocket.register` 连 `ws://127.0.0.1:<port>`；收到 typed action → 调 `eda.*` → 回传结果 + readback；断线指数退避自动重连；编辑器菜单显示连接状态、重连、配对 token 设置。
  - `daemon/`：WS 服务端（对扩展，默认端口 49630，可配）+ loopback HTTP JSON-RPC（对 MCP/CLI）。动作队列**串行**执行（EDA UI 单线程）；审计日志 JSONL 落 `~/.pcb-pilot/audit.jsonl`；维护状态（扩展连接、当前工程、最近动作）。
  - `mcp/`：stdio MCP server（`@modelcontextprotocol/sdk`），工具一一映射 typed actions；启动时检测 daemon，不在则 detached 拉起。
  - `cli/`：`pcb-pilot status | doctor | serve | stop | install`。`install` 复制 Skill 到 `~/.claude/skills`、`~/.codex/skills`、DSH 插件目录，打印各客户端 MCP 注册命令（`claude mcp add` / `codex mcp add` / JSON 配置）。
  - `skill/`：`SKILL.md` 工作流（先读工程现状 → 搜库确认器件 → 放件 → 连线 → 读回校验 → 导入 PCB → 布局布线 → DRC → 制造输出）+ typed action 参考 + 安全规则（写前读、写后验、批量动作分步确认）。
- **typed action 协议 v1**：WS 上 JSON 帧 `{id, action, params}` → `{id, ok, result?, readback?, error?}`。动作分组：`project.*`、`library.*`、`sch.*`、`pcb.*`、`output.*`、`vision.screenshot`。写动作 result 含新建图元 UUID，readback 含写入后从 API 重读的关键字段（坐标/网络/位号）。
- **安全**：所有监听只绑 `127.0.0.1`；扩展首次连接需配对 token（daemon 生成存 `~/.pcb-pilot/token`，用户在扩展菜单填一次）；全部写动作入审计日志；协议层拒绝未知 action。
- **错误模型**：`{ok:false, code, message}`，code 区分 `NOT_CONNECTED / TIMEOUT / EDA_API_ERROR / INVALID_PARAMS / TOKEN_REJECTED`；MCP 层把错误原文透传给 agent。

## 测试策略

- 协议与 daemon 逻辑：vitest 单测（帧编解码、队列串行、token、审计）。
- 集成：mock EDA WS 客户端（模拟扩展注册、应答、断线重连）跑 daemon 全链路。
- 扩展端：`tsc --noEmit` 对 `@jlceda/pro-api-types` 类型检查 + esbuild 构建出 .eext。
- 真机冒烟清单（用户执行）：装 .eext → 开外部交互 → 填 token → `pcb-pilot doctor` 全绿 → agent 放一颗电阻并读回 → DRC → 导出 Gerber。

## 用户已确认的范围决策

- **工程模式：离线/本地工程模式**（用户日常用法）。`project.*` 动作按本地工程参数适配（`createProject` 不依赖 teamUuid 云路径）；`doctor` 检查本地工作区与客户端版本；器件库搜索能力以客户端当前模式实际支持为准，Skill 中注明「离线模式下优先使用本地库/已缓存器件，搜不到时提示用户」。
- **平台：Windows 优先**。CI 只跑 Windows；路径与 daemon 进程管理按 Windows 实现，代码保持可移植（path 模块统一处理、不硬编码盘符），macOS/Linux 进路线图。

## 设计者自决事项（builder check 后定，用户可推翻）

- **单实例限制**：v1 只支持一个 EDA 实例、一个当前工程；协议帧不做多实例寻址。用户中途切换工程/标签页由「写前读回校验」兜底（readback 不符即报错停写）。多实例进路线图。
- **安装目标**：Claude Code（`~/.claude/skills`）与 Codex（`~/.codex/skills`）为一等公民；Qoder 走通用 `~/.agents/skills`（本机实证 Qoder 会读该目录）；DSH 插件形态做 best-effort（提供 manifest 与手动注册文档，不承诺 `dsh plugin add` 一键）。
- **发布身份与渠道**：本地建仓，由用户推送到自己的 GitHub 账号；npm 名 `pcb-pilot` 已验证未占用（2026-11-09）；`.eext` 只走 GitHub Release，v1 不提交官方扩展商店（避免审核/账号依赖）；`extension.json` 的 uuid 构建时生成、publisher 填用户 GitHub 用户名。

## 留给实现者决定

- 各 typed action 到 `eda.*` 的精确参数映射（以 `@jlceda/pro-api-types` 0.4.27 为准；关键方法已核实存在：`lib_Device.search/getByLcscIds`、`sch_PrimitiveComponent.create/createNetFlag/createNetPort`、`sch_PrimitiveWire.create`、`sch_Drc.check`、`pcb_PrimitiveComponent.create/modify`、`pcb_PrimitiveLine.create`、`pcb_PrimitiveVia.create`、`pcb_Document.importChanges/autoRouting/autoLayout`、`pcb_Drc.check`、`pcb_ManufactureData.getGerberFile/getBomFile/getPickAndPlaceFile/getNetlistFile/getPdfFile`、`dmt_Project.createProject/openProject`、`dmt_EditorControl.openDocument/activateDocument/getCurrentRenderedAreaImage`）。
- daemon 进程管理细节（pidfile、detached spawn、端口占用处理）。
- 默认端口最终值与 token 配对 UX。
- 铺铜是否进 v1。
- Skill 文案与 README 细节。