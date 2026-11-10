# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循 SemVer。

## [0.3.1] - 2026-11-10

### 修复

- 扩展自动激活：`activationEvents` 由空对象改为 `onStartupFinished`。v0.3.0 的 .eext 在客户端重启后需要手动点一次菜单才激活；现在客户端启动完成即自动连接 daemon（Windows V4.1.78 真机验证）。

### 文档

- Windows 真机冒烟清单 §1–§7 全部通过（2026-11-10，V4.1.78 半离线）：含切工程 READBACK_MISMATCH 锁定/拦截/重置、Gerber 九文件 zip、审计无 token 泄露、关 EDA/杀 daemon 两类断线恢复。
- 按真机结果纠正清单口径：API 放置不自动分配位号（默认 `R?`，用 `designator` 参数或 `sch_modifyComponent` 指定）；补充半离线 `library_getByLcscId` 可能返空（改用 `library_searchDevice`）、无打开文档时 `sch.*` 会等到 TIMEOUT、客户端升级后首次启动需菜单激活一次等实测注意。

## [0.3.0] - 2026-11-09

### 新增

- 自愈：动作执行前发现 daemon 根本没在跑时，客户端会自动拉起 daemon 并重试一次；`pcb-pilot doctor --fix` 一次性补齐 token、Skill 与 daemon。
- 中文品牌：README 标题、扩展显示名（`PCB Pilot 电路板助手`）、仓库描述改为中文（仓库标识仍为 `pcb-pilot`，GitHub 不允许中文 slug）。

### 变更

- `NOT_CONNECTED` 不再把「daemon 没启动」「进程活着但 RPC 无响应」「EDA 扩展没连」混成一句话：分别给出下一步命令（`pcb-pilot doctor --fix` / 看 `daemon.log` / 在 EDA 里重连）。
- 重试边界写死：只有确认 daemon 未运行（请求不可能到达过 EDA）才重放；pid 活着但 RPC 不通属于结果未知，读写动作都不重放。

## [0.2.0] - 2026-11-09

跨平台升级版：Windows / macOS / Linux 共用一套 daemon、CLI 与 MCP 适配器。

### 行为变更（升级前请读）

- `pcb-pilot doctor` 的 EDA 客户端目录检查降级为**提示项**（`!`），不再计入退出码。安装位置在各平台/各安装方式下差异太大（本机实测：`C:\Program Files\lceda-pro` 存在而 `%LOCALAPPDATA%\Programs\lceda-pro` 不存在），而「EDA 是否可用」的权威信号是扩展已连上 daemon。仍为硬门禁的是：Node 版本、daemon 运行、扩展连接、token 文件、Skill 已装。
- `PCBP_EDA_DIR` 仍是首选但不是强制：它指向的目录不存在时，`doctor` 会点名该变量说「值写错了」，然后继续按默认目录 → PATH 探测，而不是让你再去设一遍同一个变量。
- `pcb-pilot stop` 现在如实区分三种结果（已停止 / 进程早就不在、清理了 pidfile / 进程还在但不响应），最后一种退出码为 1 并指向 `daemon.log`。

### 新增

- macOS 与 Linux 支持：按平台注入的 `path.win32`/`path.posix` 生成候选路径（`/Applications/LCEDA-Pro.app`、`/opt/lceda-pro`、`~/.local/share/lceda-pro`、snap 等），并探测 PATH 里的 `lceda-pro`；目录判定跟随符号链接。
- `~/.pcb-pilot/daemon.log`：daemon 的 stdout/stderr 与启动失败原因（如端口被占用）落盘，`pcb-pilot start` 失败时报错直接给出该路径。
- 三平台 CI 矩阵（`windows-latest` / `macos-latest` / `ubuntu-latest`）与基于 `tar -tzf` 的 npm 包内容断言；`prepublishOnly` 先构建并校验 bin。
- `docs/platforms.md`（各平台安装、Gatekeeper、Linux zip、权限、端口、已知限制）、冒烟清单的平台化步骤。

### 修复

- 损坏的 `daemon.json` 在观察期后会被清理，不再让 daemon 永久无法自愈；写坏但刚写过的文件不误删。
- `isPidAlive` 只把 `EPERM` 判为存活，非法 pid（如 `2**31`，Node 抛 `ERR_INVALID_ARG_TYPE`）不再被当成活进程。
- POSIX 上 `token` 与 `audit.jsonl` 收紧为 `0600`，本工具新建的数据目录为 `0700`；不再去改动用户已存在的目录权限（`PCBP_HOME` 可能指向共享位置）。
- 构建产物强制 LF 换行：CRLF 下的 shebang 在 Linux/macOS 上会报 `bad interpreter`。
- 输出文件名对 POSIX 形式（`../../x`）与绝对路径同样只取末段。
- MCP server 版本改为读取 `package.json`，不再硬编码。
- 长时间动作（>5s）客户端不再中途超时失败。

## [0.1.0] - 未发布

首个版本：daemon + 薄适配器架构，40 个类型化动作（sch / pcb / output / project / vision），zod 校验、JSONL 审计、回读校验与 `READBACK_MISMATCH` 写入闸门，面向 Windows 离线/本地工程。
