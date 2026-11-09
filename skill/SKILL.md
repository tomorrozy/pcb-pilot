---
name: pcb-pilot
description: 通过 MCP 操控嘉立创EDA专业版（EasyEDA Pro）画原理图与 PCB。触发词：嘉立创、立创EDA、EasyEDA、画电路板、原理图、PCB、布线、DRC、Gerber、立创编号、LCSC。
---

# PCB Pilot — 用 agent 的手画电路板

你通过 `pcb-pilot` MCP 工具操控用户本机正在运行的**嘉立创EDA专业版**。所有工具名是 action 名把 `.` 换成 `_`（如 `sch.placeComponent` → `sch_placeComponent`）。

## 核心规则

1. **写前必读**：任何写动作前先 `project_getStatus` + `sch_listComponents` / `sch_listNets`，确认工程与现状。
2. **写后必验**：每个写动作返回 `readback`（含 `projectUuid`、坐标、位号）。核对不符或收到 `READBACK_MISMATCH` 时**立即停止**，告知用户「工程可能在操作中途被切换」。
3. **分步执行**：批量放件/连线时分多次调用，每步之间做读回，不要一口气提交几十个动作。
4. **器件必须从库确认**：不要臆造器件 UUID。先 `library_searchDevice` 或 `library_getByLcscId`（立创编号 C 开头），用返回的 `libraryUuid` + `uuid` 放件。
5. **离线模式**：客户端可能处于离线/本地工程模式，器件搜索能力受限；搜不到时告知用户，不要反复重试。
6. **失败如实报告**：`NOT_CONNECTED` 表示用户在 EDA 里没装/没连扩展或没开「允许外部交互」，请用户按 `pcb-pilot doctor` 的提示处理。
7. 不编造 DRC 结果、不跳过 DRC 直接声称「可以打样」。

## 工作流

### S0 了解现状
- `project_getStatus` → 当前工程 uuid / 名称。
- `sch_listComponents`、`sch_listNets` → 已有器件与网络。
- `editor_listTabs` → 当前打开了哪些文档。
- 需要看图时用 `vision_screenshot` 观察当前编辑器画面。

### S1 选型（从库确认）
- 关键词：`library_searchDevice { key: "AMS1117-3.3" }`。
- 有立创编号时：`library_getByLcscId { lcscId: "C6186" }`。
- 记录返回的 `{ libraryUuid, uuid, name, ... }` 用于放件。

### S2 放置器件
- `sch_placeComponent { device: { libraryUuid, uuid }, x, y, rotation?, designator? }`。
- 坐标按网格 2.54mm 的倍数排布，电源/接口靠边，去耦电容贴 IC 电源引脚。
- 每次放完读回位号与坐标，避免重叠。

### S3 连线与网络
- 网络标号：`sch_createNetFlag { identification: "Power"|"Ground"|..., net, x, y }`。
- 端口：`sch_createNetPort { direction: "IN"|"OUT"|"BI", net, x, y }`。
- 导线：`sch_wire { points: [[x1,y1],[x2,y2],...], net? }`。
- 优先用网络标号减少长线；总线/电源网络用标号或端口。

### S4 读回校验
- `sch_listComponents` 核对位号/数量；`sch_listNets` 核对每条网络连接。
- 和用户确认的网表逐脚对照；有 `vision_screenshot` 时截图自查布局。

### S5 进入 PCB
- `pcb_importChanges` 把原理图变更导入 PCB。
- `editor_openDocument` / `editor_activateDocument` 切换到 PCB 文档。
- `pcb_listComponents` 确认封装都已就位。

### S6 布局布线
- `pcb_autoLayout` 先粗布局；再 `pcb_moveComponent` 手工调整（连接器靠边、晶振贴 MCU、电源走线短）。
- `pcb_track { net, layer: "TOP"|"BOTTOM"|"INNER_1"..., segments: [{startX,startY,endX,endY,width?}] }` 逐段走线。
- `pcb_via { net, x, y }` 换层。
- `pcb_autoRouting` 可做兜底自动布线，之后必须 DRC。

### S7 DRC
- `sch_drc` 与 `pcb_drc`，把错误/警告原文报告给用户；修复后重跑。
- `pcb_getRules` 读取当前间距/线宽规则，走线参数不得低于规则。

### S8 制造输出
- `output_gerber`、`output_bom`、`output_pickAndPlace`、`output_netlist`、`output_pdf`。
- 返回 `{ path, sizeBytes }`，把本机路径告诉用户；不要声称已下单。

## 读回与错误码

| 错误码 | 含义 | 应对 |
|---|---|---|
| `NOT_CONNECTED` | 扩展未连接 / daemon 未运行 | 让用户跑 `pcb-pilot doctor` |
| `TIMEOUT` | 动作超时（自动布线可能较久） | 减小单次动作规模后重试 |
| `INVALID_PARAMS` | 参数不符合协议 | 按工具 schema 修正 |
| `EDA_API_ERROR` | EDA 官方 API 报错 | 原文转述给用户 |
| `READBACK_MISMATCH` | 工程被切换或写后读回不符 | 立即停止全部写入 |

完整工具与参数：`references/actions.md`。

## 安装（给用户）

`npm i -g pcb-pilot && pcb-pilot install`，然后在嘉立创EDA专业版扩展管理器安装 `.eext`、开启「允许外部交互」、菜单 PCB Pilot → 设置 Token。详见仓库 README。