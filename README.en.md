# pcb-pilot · 嘉立创EDA Circuit Board Copilot

Give AI agents real hands to design PCBs in **JLCEDA Pro / EasyEDA Pro**.

Claude Code, Codex, DeepSeek Harness, Qoder and any MCP-capable agent can create projects, search the LCSC library, place parts, wire schematics, lay out and route PCBs, run DRC, and export Gerber/BOM — through typed actions, not arbitrary JavaScript.

> Requires the **desktop Pro client** (the standard/web edition has no extension API). Targets **offline/local projects**. Daemon / CLI / MCP run on **Windows, macOS and Linux** (the three-OS CI matrix passed on GitHub Actions, POSIX-only permission tests included); the real-machine EDA loop has only been exercised on Windows so far — verify macOS/Linux yourself with `docs/platforms.md`.

## Architecture

```
Agent (MCP stdio) ⇄ pcb-pilot mcp ⇄ loopback HTTP ⇄ daemon ⇄ WebSocket ⇄ EDA .eext bridge ⇄ eda.* API
```

- **daemon**: owns the WS port (49630) and a loopback RPC port (49631), runs actions serially, writes an audit log.
- **MCP adapter**: 40 actions + `status`, over stdio.
- **.eext extension**: runs inside EDA Pro, executes typed actions via the official API, returns readbacks.
- **Skill**: teaches the agent the read-first, verify-after workflow.

## Quick start

```bash
npm i -g pcb-pilot        # Node >= 20.17
pcb-pilot install         # installs the Skill, prints MCP registration
claude mcp add pcb-pilot -- npx -y pcb-pilot mcp   # or: codex mcp add ...
pcb-pilot start
pcb-pilot status          # shows the daemon status + token location
pcb-pilot doctor --fix    # self-heal: token, Skill and daemon in one command
```

In JLCEDA Pro: install `pcb-pilot-bridge_v*.eext` from the GitHub release, enable **Allow external interaction**, open a schematic/PCB document, then **PCB Pilot → Set Token** (paste the token) and **Reconnect**. Run `pcb-pilot doctor` until the daemon / extension / token checks are green (an `!` on the client-path probe is informational — see [Platforms](#platforms)).

Then just ask:

> Create a sensor board with ESP32-C3, AMS1117-3.3, SHT30 over I2C and a WS2812 indicator; draw the schematic on a 2.54mm grid and run DRC.

## Clients

| Client | Registration |
|---|---|
| Claude Code | `claude mcp add pcb-pilot -- npx -y pcb-pilot mcp` |
| Codex | `codex mcp add pcb-pilot -- npx -y pcb-pilot mcp` |
| Claude Desktop / Cursor | `{"mcpServers":{"pcb-pilot":{"command":"npx","args":["-y","pcb-pilot","mcp"]}}}` |
| DeepSeek Harness | put `skill/` into its plugin/skill dir, register MCP as above |
| Qoder | Skill installed at `~/.agents/skills/pcb-pilot`; use the JSON config |

Multiple clients can share one daemon; restarting an agent does not drop the EDA bridge.

## Platforms

| Platform | Code + local tests | CI matrix | Real EDA machine |
|---|---|---|---|
| Windows | ✅ tests and build pass on the author's machine | ✅ `windows-latest` passing | ⏳ smoke checklist pending |
| macOS 11+ | ⬜ code path only (POSIX-only assertions are skipped on Windows) | ✅ `macos-latest` passing, POSIX tests executed | ⬜ unverified |
| Linux 4.9+ (x64/arm64) | ⬜ same | ✅ `ubuntu-latest` passing (73 passed / 1 Windows-only skipped) | ⬜ unverified |

All platforms share one data dir, `~/.pcb-pilot/` (on POSIX `token` and `audit.jsonl` are tightened to `0600`, and a dir we create is `0700`), and loopback ports `127.0.0.1:49630/49631`. The client is located by checking `PCBP_EDA_DIR` → the platform's default install dirs → a `lceda-pro` entry on `PATH`; a miss is reported as `!` and never fails `doctor`, because the authoritative signal is the extension being connected. macOS Gatekeeper, Linux zip layout and the online/half-offline re-import caveat are covered in [`docs/platforms.md`](docs/platforms.md).

Self-healing: if the daemon is not running at all, an action auto-starts it and retries once (replay only happens when the daemon was verifiably not running; a live but unresponsive daemon never gets writes replayed). `pcb-pilot doctor --fix` creates the token, installs the Skill and starts the daemon; connecting the EDA extension is still a manual step in the EDA UI.

## Security

- Loopback-only listening; pairing token (`~/.pcb-pilot/token`).
- No arbitrary JS execution — whitelisted typed actions, zod-validated.
- Every write returns a readback with `projectUuid`; switching projects mid-action yields `READBACK_MISMATCH` and stops writes.
- Actions are audited to `~/.pcb-pilot/audit.jsonl`; output files are sanitized into `~/.pcb-pilot/output/`.

## Offline mode

v1 targets offline/local projects: `project.create` needs no cloud team. Device-library search is limited by the client's offline mode; the Skill asks the user instead of inventing parts.

## Development

```bash
npm install && npm run build && npm test
npm install --prefix extension && npm test --prefix extension
npm run build --prefix extension   # emits extension/build/dist/*.eext (Node >= 24)
```

## Trademark & license

Apache-2.0. Build scripts under `extension/` are vendored from [easyeda/pro-api-sdk](https://github.com/easyeda/pro-api-sdk) (Apache-2.0) with attribution. "嘉立创EDA" and "EasyEDA" are trademarks of JLC; this project is not affiliated with the vendor and uses the names only to describe compatibility.
