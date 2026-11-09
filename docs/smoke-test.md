# 真机冒烟清单

> 在 Windows + 嘉立创EDA专业版（≥ 3.2）上执行。每一步都要看到 Expected 结果再继续；失败时记录报错原文与 `~/.pcb-pilot/audit.jsonl` 最后几行。

## 0. 准备

- [ ] `npm i -g pcb-pilot`（或使用仓库内构建产物）
- [ ] `pcb-pilot install` 输出三个 Skill 安装路径与 MCP 注册命令
- [ ] agent 客户端已注册 MCP（重启客户端）

## 1. daemon

- [ ] `pcb-pilot start` → 输出 `daemon 运行中 (pid …)`
- [ ] `pcb-pilot status` → 全部 ✓（此时扩展未连，最后一项 ✗ 是预期）
- [ ] `pcb-pilot stop` → 再 `start`，`~/.pcb-pilot/daemon.json` 重建

## 2. 安装扩展

- [ ] 从 Release 下载 `pcb-pilot-bridge_v0.1.0.eext`
- [ ] EDA 扩展管理器安装并启用
- [ ] 打开「允许外部交互」
- [ ] 打开一个原理图文档
- [ ] 菜单 PCB Pilot → 设置 Token：粘贴 `~/.pcb-pilot/token` 内容
- [ ] 菜单 PCB Pilot → 重连
- [ ] `pcb-pilot doctor` → 全部 ✓

## 3. Agent 链路

- [ ] 在 agent 里说「看下当前工程」→ 调用 `project_getStatus`，返回真实工程名/uuid
- [ ] 「在原理图放一颗 0402 电阻」→ `sch_placeComponent` 返回 `primitiveId`，EDA 画布出现器件，位号自动分配
- [ ] 「读回刚才的器件」→ `sch_listComponents` 能看到该器件，坐标与 readback 一致
- [ ] 「截图看看」→ `vision_screenshot` 返回图片（agent 端可见）
- [ ] 「跑一下原理图 DRC」→ `sch_drc` 返回真实结果

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
- [ ] 重开 EDA、打开文档、菜单重连 → agent 再次调用成功
- [ ] 杀掉 daemon（`pcb-pilot stop`）后 agent 再调用 → 返回 `NOT_CONNECTED`，`pcb-pilot start` 后恢复

## 7. 结束

- [ ] `pcb-pilot doctor` 全绿
- [ ] 把失败项与日志贴到 GitHub Issue
