# pcb-pilot 跨平台升级（v0.2）设计增补

日期：2026-11-09 ｜ 分支：`feat/cross-platform` ｜ 基线：main `773d4f6`（v0.1，Windows 优先，root 39/39 + extension 18/18）

## 1. 意图

v0.1 的 README 路线图第 1 项是「macOS / Linux 支持」。本次升级把 pcb-pilot 从「Windows 优先、代码自认可移植」升级为**有证据支持的三平台产品**：CI 在 win/mac/linux 上真实跑通测试与构建，CLI 的环境探测不再按平台写死，且修掉只在非 Windows 上才会暴露的缺陷（shebang CRLF、陈旧 pidfile、token 权限）。

## 2. 已核实的外部事实

- 官方下载页区分三平台：Windows `lceda-pro-windows-x64/arm64-<ver>.exe`；macOS（11 及以上）`lceda-pro-mac-x64/arm64-<ver>.zip`，解压得到 `LCEDA-Pro.app`，首次运行会被 Gatekeeper 拦（需右键打开或 `xattr -d com.apple.quarantine`）；Linux（4.9 以上）`lceda-pro-linux-x64/arm64/loong64/sw64-<ver>.zip`，**解压即用，没有固定安装目录**。
- 官方 API 文档「命令行客户端」章节：客户端安装时会把命令目录加入 PATH，终端里可直接执行 `lceda-pro`；文中给出的 Windows 路径是 `C:\Program Files\lceda-pro\lceda-pro.exe`（v4.1.60+），而本机实测安装位置是 `%LOCALAPPDATA%\Programs\lceda-pro`。**结论：安装目录不止一种，单一硬编码路径必然误报**；PATH 探测是跨三平台最可靠的通用信号。
- 离线模式工程数据目录（文档/博客口径）：Windows `%USERPROFILE%\Documents\LCEDA-Pro`。pcb-pilot 不直接读写工程文件（设计红线：只在官方 API 后面动文件），所以该路径仅用于文档说明。
- 扩展 API 与「允许外部交互」是 Electron 客户端里的同一套实现，三平台一致；`eda.sys_WebSocket` 出连模型不变。
- 已知平台差异提醒：在线模式与半离线模式的扩展存储互不共用，切模式后需重新导入 .eext 并重新填 token（文档要写，代码不处理）。

### 2.1 本机实测（2026-11-09，升级前 v0.1 代码）

- `%LOCALAPPDATA%\Programs\lceda-pro` **不存在**；真实安装位置是 `C:\Program Files\lceda-pro`（内含 `lceda-pro.exe`）。→ v0.1 的 doctor 在开发机自己上都报假红灯，设计文档第 2 节那条「本机已装于 %LOCALAPPDATA%」是过时观察。
- `lceda-pro` 与 `lceda-pro.exe` 已出现在 PATH 中（`/c/Program Files/lceda-pro/lceda-pro`）→ 官方安装器确实把命令目录加入 PATH，**PATH 探测在 Windows 上也成立**，三平台可用同一信号兜底。
- 结论：候选表（LOCALAPPDATA → PROGRAMFILES → PROGRAMFILES(X86) → PATH）比单一硬编码路径更正确，本次升级顺带修掉这个假阴性。

## 3. 目标

- XG1：CI 矩阵 `windows-latest / macos-latest / ubuntu-latest` 全绿；产物仍只打包一次（.eext 与 tgz 是平台中立的）。
- XG2：`pcb-pilot doctor` 在三平台都能给出正确的 EDA 客户端信号，且**不再因为「猜不到安装目录」而判失败**。
- XG3：daemon 生命周期在三平台行为一致：父进程退出后 daemon 存活；daemon 被强杀后 pidfile 陈旧不再让 CLI 卡住或误报。
- XG4：发布产物在 Unix 上真的能用：`dist/cli/main.js` 的 shebang 必须是 LF（CRLF 会让 Linux/macOS 报 bad interpreter）。
- XG5：token 文件在非 Windows 上权限为 0600（多人共享机器/CI runner 上不能全世界可读）。
- XG6：文档如实说明三平台的安装差异与已知限制，路线图勾选 macOS/Linux。

## 4. 非目标

- 不做 EDA 客户端自动启动/安装；不调用官方 `lceda-pro` CLI（不向第三方二进制交付我们的 token）。
- 不做多 EDA 实例、不做 loong64/sw64 的特化验证（只保证代码路径是通用的，社区自测）。
- 不改协议、动作集、readback/审计/安全模型的任何一条红线（127.0.0.1 单绑、配对 token、无任意 JS、写后必读、目录穿越防护全部原样保留）。
- 不引入新依赖。

## 5. 方案选择

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 到处 `process.platform === 'win32'` 分支 | 在 doctor/spawn 里各自加 if | 分支会散落且不可测；v0.1 就是这么长的 |
| **B. 单一 `src/platform.ts` 探测层 + 依赖注入（选定）** | 平台差异集中成「候选路径表 + PATH 探测」，doctor/spawn/client 接收 `platform/env/home` 参数，测试在三平台跑同一套断言 | 需要给 CLI 选项加注入点；改动面可控 |
| C. 每平台一个适配器类 | 过度抽象 | 只有「找客户端」和「pid 语义」两处差异，不值得 |

选 **B**。

## 6. 设计要点

### 6.1 `src/platform.ts`
- `edaClientCandidates(platform, env, home): string[]`：
  - win32：`%LOCALAPPDATA%\Programs\lceda-pro` → `%PROGRAMFILES%\lceda-pro` → `%PROGRAMFILES(X86)%\lceda-pro`。
  - darwin：`/Applications/LCEDA-Pro.app` → `~/Applications/LCEDA-Pro.app` → `/Applications/lceda-pro.app` → `/Applications/嘉立创EDA专业版.app`。
  - linux：`/opt/lceda-pro` → `/usr/local/lceda-pro` → `~/.local/share/lceda-pro` → `~/lceda-pro` → `/snap/lceda-pro/current`。
  - 三平台共同尾部：PATH 里名为 `lceda-pro`（win32 加 `.exe`）的可执行文件所在目录 —— 官方安装器承诺的信号。
- `findEdaClient({platform, env, home}): {found, path?, source: 'env'|'dir'|'path'|'none', candidates: string[]}`；`env.PCBP_EDA_DIR` 排在候选表首位，但**不独占**：它不存在时继续按默认目录 → PATH 探测（v0.1「可覆盖」契约不变，且避免 doctor 反过来建议用户去设一个已经设错的变量）。目录判定用 `statSync`（跟随符号链接），软链接安装的客户端也算命中。
- 路径拼接按**注入的 platform** 选 `path.win32` / `path.posix`，不用宿主的 `path.join`/`delimiter`：否则在 Windows 上跑的 darwin/linux 断言只是拿 Windows 方言自证，跨平台分支等于没测。
- 纯函数 + 注入的 `exists/isFile` 回调，测试不需要真装 EDA。

### 6.2 doctor 语义调整（有意的行为变更）
- EDA 客户端目录检查降级为**提示项**（`!` 前缀），不再计入退出码；理由：安装目录本身多变（官方文档与本机实测不同、Linux 无固定目录），而「EDA 是否可用」的权威信号是**扩展已连上 daemon**。硬失败会给装在新路径的真实用户一个假红灯。
- 仍是硬门禁的：daemon 运行、扩展连接、token 文件、Skill 已装、Node 版本。
- 非 Windows 不再打印「跳过检查」，而是给出该平台候选路径与 Gatekeeper/AppImage 提示。

### 6.3 daemon 生命周期
- `isPidAlive(pid)`：`process.kill(pid, 0)`；**只有 `EPERM` 视为存活**（Unix 上属于别人的进程也算活，交给 RPC 探活兜底），`ESRCH` 与任何其它错误（含 Node 对非法 pid 抛的 `ERR_INVALID_ARG_TYPE`）一律视为不存在；非 `Number.isSafeInteger` 或 `<= 0` 直接判死。
- `DaemonClient.status()`：先探 RPC；失败且 pid 已死 → **删除陈旧 `daemon.json`** 后抛「daemon 未运行」；pid 活着但 RPC 不通 → 保留文件（可能正在启动）。
- 无法解析的 `daemon.json`（写坏/被截断）同样走清理，但加 **mtime 最短观察期（5s）**：pid 字段拿不到时，只清理「不是刚刚写过」的文件，避免抢在另一个 daemon 的写入过程中把它删掉。
- `shutdown()` 返回 `'stopped' | 'stale-cleaned' | 'still-running'`：RPC 后等文件消失；3s 内未消失但 pid 已死 → 清理文件；进程还在且不响应 → 如实返回 `still-running`，`pcb-pilot stop` 据此 exit 1 并指向 `daemon.log`。不给任意 pid 发信号（避免 pid 复用误杀）。
- `ensureDaemon()`：给 spawn 子进程挂 `error` 监听（POSIX 上 spawn 失败是异步事件，未监听会让 CLI 直接崩），把错误同时记进 `daemon.log`；子进程的 stdout/stderr 由 `stdio:'ignore'` 改为追加到 `<dataDir>/daemon.log`（`0600`），否则 daemon 启动失败（端口被占等）的原因永久丢失。保持 detached + `unref()`。

### 6.4 Unix 发布正确性
- `tsconfig.json` 加 `"newLine": "lf"`；新增 `.gitattributes`（`* text=auto eol=lf`，`.eext`/图片标 binary）。
- CI 三平台构建后校验 `dist/cli/main.js` 首行无 `\r`。
- `package.json` 加 `prepublishOnly`（v0.1 遗留 minor，顺手补上，防发布旧 dist）。

### 6.5 token 与审计文件权限
- `loadOrCreateToken` 无论新建还是复用，POSIX 下把 `token` 收紧到 `0600`（`writeFileSync` 的 mode 只在建文件时生效，已有文件不会改）。Windows 上 try/catch 忽略。
- **收紧的是文件而不是目录**（原计划的 `chmod 0700` 数据目录已放弃）：`PCBP_HOME` 允许指向用户自选的位置，daemon 去改一个不是自己创建的目录权限属于越权副作用；而 POSIX 下 0755 目录只暴露文件名，token 与 `audit.jsonl`（内含工程内容）各自 `0600` 就足以阻止同机其他用户读取内容。
- 由本工具新建的数据目录仍是 `0700`；`AuditLogger` 构造时对审计文件走同一条收紧路径。

### 6.6 CI/Release
- ci.yml：matrix 三 OS，`fail-fast: false`；typecheck/test/build 全跑；artifact 仅由 `ubuntu-latest` 上传（避免同名冲突）；新增 bin-EOL 校验步。
- release.yml：改为 `ubuntu-latest`（产物平台中立，Linux runner 更快更便宜），步骤等价 + 同一校验。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| CI 三平台矩阵首次跑可能暴露本地没发现的时序/端口差异 | 矩阵先只在 PR 上开，`fail-fast: false` 便于一次看全三平台日志 |
| Linux zip 安装根本无法探测 | 已降级为提示项，不阻塞；文档说明 `PCBP_EDA_DIR` |
| 软检查改变了 Windows 用户看到的 doctor 红灯数量 | 属意的语义修正，写进 changelog 与 README；真信号仍由扩展连接提供 |
| macOS Gatekeeper 导致用户打不开客户端 → 误判 pcb-pilot 坏 | README/docs 专节写明放行步骤 |

## 8. 设计者自决事项（未询问用户）

- macOS 与 Linux **同时**支持（不是先 mac 后 linux）：代码差异集中在一张候选表，分开做只会重复劳动。
- 配置目录继续用 `~/.pcb-pilot`，**不**改用 XDG / `~/Library/Application Support`：v0.1 文档、Skill、审计路径都以此为准，跨平台一致性优先于平台惯例；`PCBP_HOME` 已提供改写口子。
- doctor 的 EDA 目录项降级为提示项（见 6.2）。
- 不做 `os` 字段限制与 FreeBSD 适配。
- 版本号按 0.2.0 预备（本次不 bump 到发布提交，等真机冒烟后统一 bump）。
- 审查修复阶段的自决（2026-11-09）：
  - `PCBP_EDA_DIR` 保持「首位但可回退」，不改成严格覆盖：两种语义都能自洽，但回退链与文档、v0.1「可覆盖」契约、以及其它诊断项的思路一致；单测通过注入 `env`（不带 PATH、静态目录不存在）保持与宿主无关。
  - 目录判定用 `statSync` 而非 `lstatSync`：软链接到 app bundle 是 macOS 上的常见安装形态。
  - 候选路径按**目标平台**方言拼接（`path.win32`/`path.posix`）：否则在 Windows 上跑的非 Windows 分支断言毫无意义。
  - 权限收紧对象从「数据目录」改为「token 与 audit.jsonl 文件」：`PCBP_HOME` 可以是用户自选的共享目录，改其权限属于越权；POSIX 下 0755 目录只暴露文件名，0600 文件才拦住内容。新建目录仍给 0700。
  - 损坏 pidfile 的清理加 5s mtime 观察期；同时把子进程输出改为追加 `<dataDir>/daemon.log`（取代 `stdio:'ignore'`）—— 后台 daemon 启动失败的原因不该永久丢失。
  - 三平台 CI 与真机状态一律按「配置了但未实跑」表述：仓库还没有远端，矩阵一次都没跑过，不能写成 ✅。（2026-11-09 首跑 [run 42576710403](https://github.com/tomorrozy/pcb-pilot/actions/runs/42576710403) 三平台全绿、POSIX 用例实跑后，文档口径上调为 CI ✅；EDA 真机列仍保持未验证。）
