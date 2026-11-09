---
name: pcb-pilot
description: 通过 MCP 操控嘉立创EDA专业版（EasyEDA Pro）画原理图与 PCB。触发词：嘉立创、立创EDA、EasyEDA、画电路板、原理图、PCB、布线、DRC、Gerber、立创编号。
---

# PCB Pilot（占位）

完整工作流在 v0.1.0 发布前由 Task 10 补全。当前可用工具见 `references/actions.md`。

安全规则：
- 写前先读：`project_getStatus` + `sch_listComponents` / `sch_listNets`。
- 写后必验：检查返回的 readback；`READBACK_MISMATCH` 立即停止并告知用户。
- 批量动作分步执行。