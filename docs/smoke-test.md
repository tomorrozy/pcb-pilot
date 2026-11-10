# 真机冒烟清单

> 在 Windows / macOS / Linux 任意的嘉立创EDA专业版（≥ 3.2）上执行。每一步都要看到 Expected 结果再继续；失败时记录报错原文与 `~/.pcb-pilot/audit.jsonl` 最后几行。平台特有的准备（Gatekeeper、Linux 解压目录、`PCBP_EDA_DIR`）见 `docs/platforms.md`。

## 0. 准备

- [ ] 按 `docs/platforms.md` 完成本平台的客户端安装准备（macOS 需放行 Gatekeeper；Linux 需记下解压目录）
- [ ] `npm i -g pcb-pilot`（或使用仓库内构建产物）
- [ ] `pcb-pilot install` 输出三个 Skill 安装路径与 MCP 注册命令
- [ ] agent 客户端已注册 MCP（重启客户端）

## 1. daemon

- [ ] `pcb-pilot start` → 输出 `daemon 运行中 (pid …)`
- [ ] `pcb-pilot status` → `✓ daemon 运行中`；扩展未连时 `✗ EDA 扩展未连接`，退出码 1（这是本步的预期，不是 daemon 坏了）
- [ ] `pcb-pilot stop` → 输出「已停止」；再 `start`，`~/.pcb-pilot/daemon.json` 重建
- [ ] 强杀 daemon（POSIX `kill -9 <pid>` / Windows 任务管理器「结束进程」）→ `pcb-pilot status` 报未运行，且陈旧的 `~/.pcb-pilot/daemon.json` 被自动清理，再 `start` 可恢复
- [ ] 端口被占用时的可诊断性：先占住 WS 端口（如 `nc -l 127.0.0.1 49630` / `python -m http.server 49630`），再 `PCBP_HOME=$(mktemp -d) pcb-pilot start` → 报错里带 `daemon.log` 路径，且 `~/.pcb-pilot/daemon.log` 里有 `EADDRINUSE` 原始堆栈
- [ ] `pcb-pilot doctor`：`PCBP_EDA_DIR` 指向真实客户端目录时 EDA 客户端项为 ✓；不设该变量时该项是 `!`（提示）而不是 ✗，且不影响退出码
- [ ] `PCBP_EDA_DIR` 指到一个不存在的目录 → 该项为 `!`，提示里点名「PCBP_EDA_DIR 指向的目录不存在（…）」，而不是让你再去设同一个变量

## 2. 安装扩展

- [ ] 从 Release 下载 `pcb-pilot-bridge_v*.eext`（连上后 `pcb-pilot status` 会显示扩展版本）
- [ ] EDA 扩展管理器安装并启用
- [ ] 打开「允许外部交互」
- [ ] 打开一个原理图文档
- [ ] 菜单 PCB Pilot → 设置 Token：粘贴 `~/.pcb-pilot/token` 内容
- [ ] 菜单 PCB Pilot → 重连
- [ ] `pcb-pilot doctor` → daemon/扩展/token/Skill 全 ✓（EDA 客户端项为 ✓ 或提示 `!` 都算通过）

## 3. Agent 链路

- [ ] 在 agent 里说「看下当前工程」→ 调用 `project_getStatus`，返回真实工程名/uuid
- [ ] 「在原理图放一颗 0402 电阻」→ `sch_placeComponent` 返回 `primitiveId`，EDA 画布出现器件。注意：API 放置**不自动分配位号**（默认 `R?` 等），用 `designator` 参数指定或事后 `sch_modifyComponent` 修改
- [ ] 「读回刚才的器件」→ `sch_listComponents` 能看到该器件，坐标与 readback 一致
- [ ] 「截图看看」→ `vision_screenshot` 返回图片（agent 端可见）
- [ ] 「跑一下原理图 DRC」→ `sch_drc` 返回真实结果

实测注意（Windows / V4.1.78 / 半离线）：

- 半离线模式下 `library_getByLcscId` 可能返回空（系统库未同步 LCSC 编号索引）；改用 `library_searchDevice` 按型号/参数搜索可命中。
- 当前工程没有打开原理图文档时，`sch.*` 动作会挂起等到 `TIMEOUT`（EDA API 行为）；先按第 2 节打开文档再操作。

## 4. 切工程防护

- [ ] 让 agent 连续放两颗电阻（第二个动作前手动切换到另一个工程）
- [ ] 第二个写动作返回 `READBACK_MISMATCH`，agent 停止写入并提示

## 5. 制造输出

- [ ] 打开 PCB 文档，`pcb_importChanges` 成功
- [ ] `pcb_drc` 返回真实结果
- [ ] 「导出 Gerber」→ `output_gerber` 返回 `{path, sizeBytes}`
- [ ] `~/.pcb-pilot/output/` 下能看到 zip，可用解压工具打开
- [ ] `~/.pcb-pilot/audit.jsonl` 能看到上述动作记录（无 token 泄露）

## 6. 断线恢复

- [ ] 关掉 EDA → `pcb-pilot status` 显示扩展未连接
- [ ] 重开 EDA、打开文档、菜单重连 → agent 再次调用成功（正常重启时扩展会自动连接，无需菜单；客户端**升级后首次启动**若未自动连接，菜单 PCB Pilot → 重连 激活一次即可）
- [ ] 杀掉 daemon（`pcb-pilot stop`）后 agent 再调用 → 返回 `NOT_CONNECTED`，`pcb-pilot start` 后恢复

## 7. 结束

- [ ] `pcb-pilot doctor`：daemon/扩展/token/Skill 四项 ✓（EDA 客户端项允许为 `!`）
- [ ] 把失败项与日志贴到 GitHub Issue
