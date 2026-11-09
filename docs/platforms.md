# 平台说明（Windows / macOS / Linux）

pcb-pilot 由三部分组成：本机 daemon（Node）、MCP/CLI 适配器（同一个 npm 包）、以及跑在嘉立创EDA专业版里的 `.eext` 桥接扩展。扩展在 EDA 内部用官方 `eda.*` API，三平台是同一套 Electron 实现；daemon 与 CLI 是纯 Node 代码，不依赖任何平台原生模块。

## 支持状态（先说清哪些是验证过的）

| 平台 | 代码与 CI | EDA 真机联调 |
|---|---|---|
| Windows | ✅ CI `windows-latest` 跑 typecheck/测试/构建/.eext 打包 | ⏳ 待按 `docs/smoke-test.md` 执行 |
| macOS | ✅ CI `macos-latest` 同上 | ⬜ 未验证（需一台 Mac 跑冒烟清单） |
| Linux | ✅ CI `ubuntu-latest` 同上 | ⬜ 未验证（需一台 Linux 跑冒烟清单） |

> CI 只证明「我们的代码在该平台可安装、可运行、可通过测试」。EDA 扩展是否在你的 Mac/Linux 客户端里正常连上 daemon，必须由冒烟清单确认 —— 在那之前不要把某平台称作「真机可用」。

## Windows

- 客户端默认位置有两种：`C:\Program Files\lceda-pro`（为所有用户安装）和 `%LOCALAPPDATA%\Programs\lceda-pro`（为当前用户安装）。官方安装器会把命令目录加进 PATH，`lceda-pro.exe` / `lceda-pro` 通常可直接调用。
- `pcb-pilot doctor` 按 `PCBP_EDA_DIR` → 上述两个目录 → `Program Files (x86)` → PATH 的顺序探测。
- 装到自定义目录（例如 D 盘）时设 `PCBP_EDA_DIR=D:\Some\Path\lceda-pro`。

## macOS

- 下载页选 macOS 对应芯片的 zip（Apple 芯片用 arm64，Intel 用 x64），解压得到 `LCEDA-Pro.app`，**拖入「应用程序」再打开**（在 dmg/解压目录里直接运行会导致更新与权限异常）。
- 首次打开若提示「无法验证开发者 / 已损坏」，这是 Gatekeeper 拦截：右键应用 →「打开」；仍不行则在「系统设置 → 隐私与安全性」点「仍然允许」，或
  ```bash
  sudo xattr -r -d com.apple.quarantine /Applications/LCEDA-Pro.app
  ```
- `doctor` 的候选路径含 `/Applications/LCEDA-Pro.app`、`~/Applications/LCEDA-Pro.app`。
- 全局安装建议用 nvm 管理 Node，避免 `sudo npm i -g`：
  ```bash
  npm i -g pcb-pilot
  ```

## Linux

- 官方分发是 zip（x64 / arm64 / loong64 / sw64），**解压即用，没有固定安装目录**，因此 `doctor` 大概率探测不到客户端目录 —— 这不影响 agent 链路：扩展连上 daemon 才是真信号。把目录告诉它即可：
  ```bash
  export PCBP_EDA_DIR="$HOME/apps/lceda-pro"
  ```
- 若拿到的是 AppImage：`chmod +x lceda-pro-*.AppImage` 后运行。
- 把客户端命令目录放进 PATH（很多包会自带 `lceda-pro` 启动脚本）也能让 `doctor` 探测成功。

## 三平台共通

- 数据目录统一是 `~/.pcb-pilot/`（`token`、`audit.jsonl`、`daemon.json`、`output/`、可选 `config.json`），不随平台改路径；用 `PCBP_HOME` 可整体迁移。
- `PCBP_EDA_DIR` 是**首选**而不是强制：它指向的目录不存在时，`doctor` 会点名这个变量（说明值写错了），然后继续按默认目录 → PATH 探测，不会因此卡住。
- POSIX 上数据目录权限收紧为 `0700`、token 为 `0600`（daemon 启动时会自动纠正已有的宽松权限）。
- 端口默认 `49630`（WS）/ `49631`（RPC），只绑 `127.0.0.1`；可用 `PCBP_WS_PORT` / `PCBP_RPC_PORT` 覆盖。
- daemon 后台化：`pcb-pilot start` 之后父进程退出、终端关闭都不影响 daemon；daemon 被强杀（`kill -9` / 任务管理器结束进程）后，下一次 `pcb-pilot status` 会报未运行并清掉陈旧的 `daemon.json`。
- **在线模式与半离线/离线模式的扩展存储互不共用**：切换 EDA 运行模式后，需要在新模式下重新导入 `.eext` 并重新填一次 token。

## 已知限制

- macOS / Linux 的 EDA 真机链路尚未由本项目验证（见上表）。
- loong64 / sw64 等架构只保证代码路径通用，未做设备验证。
- 一台机器同时只支持一个 EDA 实例连接 daemon（多实例在路线图上）。
