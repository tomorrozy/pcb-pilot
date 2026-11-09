# pcb-pilot 跨平台升级 实施计划

> 执行方式：本会话 Native inline，逐任务 TDD（红→绿→提交）。基线 `773d4f6`，分支 `feat/cross-platform`。
> 设计依据：`docs/superpowers/specs/2026-11-09-pcb-pilot-cross-platform-design.md`。

## Global Constraints

- 安全红线不变：只绑 `127.0.0.1`；token 不入审计；无任意 JS 通道；写动作必须 readback；输出文件名防目录穿越。
- 不新增运行时依赖；不新增 devDependency。
- 协议、动作集（40）、错误码（7）不变。
- 所有平台相关逻辑必须可通过参数注入 `platform/env/home` 测试，三平台跑同一套断言（禁止在测试里 `if (process.platform...)` 决定期望值，除权限语义这类 OS 事实外）。
- 每任务结束：`npx vitest run` + `npm run typecheck` 全绿才提交。

---

### Task C1: `src/platform.ts` EDA 客户端探测层

**Files:** Create `src/platform.ts`；Test `src/platform.test.ts`

**Interfaces:**
- `EdaClientSource = 'env' | 'dir' | 'path' | 'none'`
- `EdaClientLookupOptions { platform: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string; exists?: (p: string) => boolean; isDirectory?: (p: string) => boolean }`
- `edaClientCandidates(opts): string[]` —— 顺序即优先级：`PCBP_EDA_DIR` 首位（若设置）；win32 用 `%LOCALAPPDATA%\Programs\lceda-pro`、`%PROGRAMFILES%\lceda-pro`、`%PROGRAMFILES(X86)%\lceda-pro`；darwin 用 `/Applications/LCEDA-Pro.app`、`<home>/Applications/LCEDA-Pro.app`、`/Applications/lceda-pro.app`、`/Applications/嘉立创EDA专业版.app`；linux 用 `/opt/lceda-pro`、`/usr/local/lceda-pro`、`<home>/.local/share/lceda-pro`、`<home>/lceda-pro`、`/snap/lceda-pro/current`；三平台尾部追加 PATH 中 `lceda-pro(.exe)` 的所在目录。
- `findEdaClient(opts): { found: boolean; path?: string; source: EdaClientSource; candidates: string[] }`
- `platformNotes(platform): string` —— doctor 尾部提示用：win32「装到自定义目录请设 PCBP_EDA_DIR」；darwin「zip 解压出 LCEDA-Pro.app，被 Gatekeeper 拦时右键打开或 `sudo xattr -r -d com.apple.quarantine /Applications/LCEDA-Pro.app`」；linux「zip 解压即用、无固定目录，请设 PCBP_EDA_DIR 指向解压目录」。

- [ ] **Step 1: 写失败测试** —— 断言：① `PCBP_EDA_DIR` 存在时 `findEdaClient` 返回 `source:'env'` 且路径为它；② win32 候选含 `%LOCALAPPDATA%\Programs\lceda-pro` 且不含 `/opt/lceda-pro`；③ darwin 候选含 `/Applications/LCEDA-Pro.app`、`<home>/Applications/LCEDA-Pro.app`，不含 win32 项；④ linux 候选含 `/opt/lceda-pro`；⑤ PATH 里放一个假 `lceda-pro` 可执行文件（`exists`+`isDirectory` 注入）时，三平台都能通过 `source:'path'` 命中其目录；⑥ 全不存在时 `found:false, source:'none'`，`candidates` 非空；⑦ `platformNotes('darwin')` 含 `Gatekeeper`，`platformNotes('linux')` 含 `PCBP_EDA_DIR`。
- [ ] **Step 2: 跑确认失败** —— `npx vitest run src/platform` → FAIL（模块不存在）。
- [ ] **Step 3: 实现** —— 纯函数、注入 `exists/isDirectory`（默认 `existsSync/lstatSync`）。
- [ ] **Step 4: 跑确认通过** —— `npx vitest run && npm run typecheck` → PASS。
- [ ] **Step 5: Commit** —— `feat: platform-aware lceda-pro client discovery`

---

### Task C2: doctor 用探测层 + EDA 项降级为提示

**Files:** Modify `src/cli/commands.ts`、`src/cli/cli.test.ts`

**Interfaces:**
- `CommandOptions` 增 `platform?: NodeJS.Platform`（默认 `process.platform`）。
- 检查结果条目改为 `{ level: 'ok' | 'warn' | 'fail'; label; hint? }`，打印 `✓ / ! / ✗`；**退出码只由 `fail` 项决定**（Node 版本、daemon、扩展连接、token、Skill）。
- EDA 客户端项：找到 → `ok`（打印路径与来源）；没找到 → `warn`（打印候选路径前若干条 + `platformNotes`）；任何情况下不影响退出码。
- 删除 `process.platform === 'win32'` 分支与「非 Windows 跳过」文案。

- [ ] **Step 1: 改测试（红）** —— ① 原「全缺失 exit 1 且含『允许外部交互』」保留并加断言：输出含 `! ` 行与 `PCBP_EDA_DIR`；② 新增 `platform: 'darwin'` 用例：`PCBP_EDA_DIR` 指向真实临时目录 → 输出含 `LCEDA` 无关但含该路径与 `✓`，且 daemon 缺失仍 exit 1；③ 新增用例：`platform: 'linux'` + 不存在的 EDA 目录 → 输出含 `!`，且当 daemon/扩展/token/Skill 都正常时 exit 0（用注入：把 daemon 项也做成可注入？——不做；改为断言 exit 1 只由「daemon 未运行」引起：输出里 `✗` 行仅 1 条且为 daemon）。
- [ ] **Step 2: 跑确认失败** —— `npx vitest run src/cli` → FAIL。
- [ ] **Step 3: 实现** —— 按 Interfaces。
- [ ] **Step 4: 跑确认通过** —— 全量 `npx vitest run` + typecheck → PASS。
- [ ] **Step 5: Commit** —— `feat: doctor reports eda client as advisory across platforms`

---

### Task C3: daemon 进程与 pidfile 跨平台

**Files:** Modify `src/daemon/client.ts`、`src/daemon/paths.ts`（不动）；Test `src/daemon/infra.test.ts` 增组 + `test/integration/client.test.ts` 增组

**Interfaces:**
- `client.ts` 内部：`isPidAlive(pid: number): boolean`（`process.kill(pid,0)`，`ESRCH`→false，其他→true）；`readDaemonFile()` 保持纯读；新增私有 `pruneStaleDaemonFile()`：pid 不存活 → `unlinkSync(daemonFile)`。
- `status()`：RPC 失败后调 `pruneStaleDaemonFile()`，若确实清掉了文件则抛 `daemon is not running (stale pidfile removed)`。
- `shutdown()`：RPC → 轮询文件消失（≤3s）→ 仍在场且 pid 死 → 清理。
- `ensureDaemon()`：`child.on('error', ...)` 记录后继续走轮询（POSIX spawn 失败不崩 CLI）。

- [ ] **Step 1: 写失败测试** —— ① 伪造 `daemon.json`（pid 用一个肯定不存在的号，如 `2 ** 30`；若平台拒绝则退化为 999999）→ `status()` reject 且 `daemon.json` 已被删除；② pid 为 `process.pid`（必活）但端口无人监听 → `status()` reject 且文件仍在；③ 陈旧文件场景下 `ensureDaemon()` 不会因残留 pidfile 直接返回旧 daemon（临时 home，指向不存在的 rpcPort）。
- [ ] **Step 2: 跑确认失败** —— FAIL（现在陈旧 pidfile 会让文件留着，且每次调用打一次 RPC）。
- [ ] **Step 3: 实现** —— 按 Interfaces。
- [ ] **Step 4: 跑确认通过** —— 全量 + typecheck；再起一次真 daemon 冒烟：`node dist/cli/main.js start && node dist/cli/main.js status`（本机 Windows）→ PASS。
- [ ] **Step 5: Commit** —— `fix: prune stale daemon pidfile and survive posix spawn errors`

---

### Task C4: token 权限 + 输出路径的 POSIX 语义

**Files:** Modify `src/daemon/token.ts`；Test `src/daemon/infra.test.ts`、`test/integration/daemon.test.ts`

- [ ] **Step 1: 写失败测试** —— ① 先以 0o644 建好 token 文件再 `loadOrCreateToken` → 非 win32 上 `statSync(...).mode & 0o777 === 0o600`（`it.runIf(process.platform !== 'win32')`，属 OS 事实例外）；② win32 上同一调用不抛异常（`it.runIf(process.platform === 'win32')` 断言内容不变）；③ 集成：`output.gerber` 返回 `fileName: '../../tmp/evil.zip'`（POSIX 穿越形式）→ 落盘路径仍在 `outputDir` 内。
- [ ] **Step 2: 跑确认失败** —— ① FAIL（mode 仍 644），③ 可能已 PASS（回归钉桩）。
- [ ] **Step 3: 实现** —— `chmodSync` 包 try/catch。
- [ ] **Step 4: 跑确认通过** —— 全量 + typecheck。
- [ ] **Step 5: Commit** —— `fix: enforce 0600 token mode on posix and pin unix path-traversal`

---

### Task C5: LF shebang、.gitattributes、prepublishOnly

**Files:** Modify `tsconfig.json`、`package.json`；Create `.gitattributes`、`scripts/check-bin-eol.mjs`；Test `scripts` 由 CI 调，另加 `src/cli/bin-eol.test.ts`

- [ ] **Step 1: 写失败测试** —— `src/cli/bin-eol.test.ts`：对**已构建**产物做校验，若 `dist/cli/main.js` 不存在则 `it.skip` 并提示先 build；断言首个 `\n` 之前不含 `\r`，且文件以 `#!/usr/bin/env node` 开头。同时无条件断言源码 `src/cli/main.ts` 首行无 `\r`（在 Windows 上也能跑）。
- [ ] **Step 2: 跑确认失败/钉桩** —— 若本机 dist 为 CRLF 则红；否则记录为回归钉（本地 Windows 可能已 LF，重点是 Linux/macOS runner）。
- [ ] **Step 3: 实现** —— tsconfig `"newLine": "lf"`；`.gitattributes`：`* text=auto eol=lf`、`*.eext binary`、`*.png/*.ico binary`；`scripts/check-bin-eol.mjs`（CI 用，退出码 1 于 CRLF）；`package.json` 加 `"prepublishOnly": "npm run build"` 与 `"check:bin": "node scripts/check-bin-eol.mjs"`。
- [ ] **Step 4: 验证** —— `rm -rf dist && npm run build && npm run check:bin && npx vitest run` → PASS。
- [ ] **Step 5: Commit** —— `build: force LF newlines, gitattributes and bin eol check`

---

### Task C6: CI 三平台矩阵 + Release 迁移

**Files:** Modify `.github/workflows/ci.yml`、`.github/workflows/release.yml`

**Interfaces:** ci.yml `strategy.matrix.os: [windows-latest, macos-latest, ubuntu-latest]`、`fail-fast: false`、`defaults.run.shell: bash`；步骤：checkout → setup-node 24（cache npm）→ `npm ci` → `npm ci --prefix extension` → typecheck×2 → 测试×2 → build×2 → `npm run check:bin` → `npm pack --dry-run`；仅 `matrix.os == 'ubuntu-latest'` 上传 .eext 与 tgz（artifact 名保持不变）。release.yml 改 `runs-on: ubuntu-latest`，步骤同 CI 再加 `npm run check:bin` 后 `npm pack` 并 release 上传。

- [ ] **Step 1: 写 workflow** —— 按 Interfaces。
- [ ] **Step 2: 本地全量预演** —— `npm ci && npm ci --prefix extension && npm run typecheck && npm run typecheck --prefix extension && npx vitest run && npm test --prefix extension && npm run build && npm run build --prefix extension && npm run check:bin && npm pack --dry-run` → 全 PASS。
- [ ] **Step 3: Commit** —— `ci: windows/macos/linux test matrix and linux-packaged releases`

---

### Task C7: 文档与路线图

**Files:** Modify `README.md`、`README.en.md`、`docs/smoke-test.md`、`skill/SKILL.md`（如提及平台）；Create `docs/platforms.md`

- [ ] **Step 1: 写文档** —— README 顶部限制语从「Windows 优先」改为「Windows / macOS / Linux（专业版桌面客户端 ≥3.2；macOS 11+，Linux 4.9+）」；新增「平台说明」小节，指向 `docs/platforms.md`；路线图勾选 macOS/Linux；`docs/platforms.md` 覆盖：三平台客户端获取方式、macOS Gatekeeper、Linux zip 无固定目录 + `PCBP_EDA_DIR`、PATH 探测、`~/.pcb-pilot` 与 `PCBP_HOME`、token 权限、离线/半离线扩展存储互不共用（切模式需重导 .eext + 重填 token）、`npm i -g` 在 macOS 建议 nvm 避免 sudo；`docs/smoke-test.md` 头部改为「任选平台执行，第 0 步按 `docs/platforms.md` 完成平台特有准备」，并给 daemon 段补一条「kill -9 daemon 后再 `pcb-pilot status` → 提示未运行且陈旧 pidfile 被清理」。
- [ ] **Step 2: 一致性校验** —— `node -e` 复核 actions.md 覆盖 40 个动作（沿用 v0.1 校验脚本）；grep 确认 README 无残留「仅 Windows」表述。
- [ ] **Step 3: Commit** —— `docs: platform guide for macos and linux`

---

## Self-Review

- XG1→C6；XG2→C1/C2；XG3→C3；XG4→C5；XG5→C4；XG6→C7。
- 类型一致性：`EdaClientLookupOptions` 与 `runDoctor(opts.platform)` 注入点一致；`findEdaClient` 返回形状在 C2 消费处一致。
- 未覆盖项：真机 macOS/Linux 联调仍需用户或社区设备（CI 只证明代码层通过，不证明 EDA 扩展在 mac/linux 上真跑通）——**不得宣称 macOS/Linux 真机可用**，文档里写作「CI 覆盖 / 待真机验证」。
