# PCB Pilot Action 参考（40 个）

工具名 = action 名把 `.` 换成 `_`。写动作标注 **[写]**，返回 `readback`。

## 工程与编辑器

| Action | 参数 | 说明 |
|---|---|---|
| `project.getStatus` | — | 当前工程信息 |
| `project.create` | `friendlyName: string, projectName?: string, description?: string` | [写] 创建本地工程（离线模式，不传云参数） |
| `project.open` | `projectUuid: string` | 打开工程 |
| `project.save` | — | [写] 保存原理图与 PCB |
| `editor.openDocument` | `documentUuid: string` | 打开文档，返回 tabId |
| `editor.activateDocument` | `tabId: string` | 激活标签页 |
| `editor.listTabs` | — | 编辑器分屏/标签树 |

## 器件库

| Action | 参数 | 说明 |
|---|---|---|
| `library.searchDevice` | `key: string, itemsOfPage?: number, page?: number` | 关键词搜器件 |
| `library.getByLcscId` | `lcscId: string` | 按立创编号（C 开头）取器件 |

## 原理图 sch.*

| Action | 参数 | 说明 |
|---|---|---|
| `sch.placeComponent` | `device: { libraryUuid, uuid }, x: number, y: number, rotation?: number, designator?: string` | [写] 放器件，readback 含坐标/位号 |
| `sch.createNetFlag` | `identification: 'Power'\|'Ground'\|'AnalogGround'\|'ProtectGround', net: string, x: number, y: number, rotation?: number` | [写] 电源/地标号 |
| `sch.createNetPort` | `direction: 'IN'\|'OUT'\|'BI', net: string, x: number, y: number, rotation?: number` | [写] 网络端口 |
| `sch.wire` | `points: [[x,y],...] (≥2), net?: string` | [写] 连线 |
| `sch.modifyComponent` | `id: string, x?, y?, rotation?, designator?` | [写] 修改器件 |
| `sch.delete` | `type: 'component'\|'wire'\|'netFlag'\|'netPort', ids: string[]` | [写] 删除图元 |
| `sch.listComponents` | — | 列出全部器件 |
| `sch.listNets` | — | 列出全部网络 |
| `sch.importChanges` | — | [写] 导入变更 |
| `sch.autoLayout` | — | [写] 自动布局（长超时 180s） |
| `sch.drc` | — | 原理图 DRC |
| `sch.save` | — | [写] 保存 |

## PCB pcb.*

| Action | 参数 | 说明 |
|---|---|---|
| `pcb.placeComponent` | `device: { libraryUuid, uuid }, x, y, rotation?, layer?` | [写] 放封装 |
| `pcb.moveComponent` | `id, x?, y?, rotation?, layer?` | [写] 移动器件 |
| `pcb.track` | `net: string, layer: 'TOP'\|'BOTTOM'\|'INNER_1'..., segments: [{startX,startY,endX,endY,width?}]` | [写] 逐段走线 |
| `pcb.via` | `net, x, y, holeDiameter?=0.3, diameter?=0.6` | [写] 过孔 |
| `pcb.delete` | `type: 'component'\|'track'\|'via', ids: string[]` | [写] 删除图元 |
| `pcb.listComponents` | — | 列出 PCB 器件 |
| `pcb.listNets` | — | 列出 PCB 网络 |
| `pcb.importChanges` | — | [写] 从原理图导入变更 |
| `pcb.autoLayout` | — | [写] 自动布局（180s） |
| `pcb.autoRouting` | — | [写] 自动布线（180s） |
| `pcb.drc` | — | PCB DRC |
| `pcb.getRules` | — | 当前设计规则 |
| `pcb.save` | — | [写] 保存 |

## 制造输出 output.*

均返回 `{ fileName, base64, sizeBytes }`，daemon 会把文件落到 `~/.pcb-pilot/output/` 并只回 `{ path, sizeBytes }`。

| Action | 参数 |
|---|---|
| `output.gerber` | `fileName?: string` |
| `output.bom` | `fileName?: string` |
| `output.pickAndPlace` | `fileName?: string` |
| `output.netlist` | `fileName?: string` |
| `output.pdf` | `fileName?: string` |

## 视觉

| Action | 参数 | 说明 |
|---|---|---|
| `vision.screenshot` | `tabId?: string` | 当前编辑器区域截图，返回 PNG base64（MCP 以 image content 返回） |

## 只读状态工具

| Tool | 说明 |
|---|---|
| `status` | daemon 与扩展连接、当前工程、pending 数 |

## 错误码

`NOT_CONNECTED` / `TIMEOUT` / `EDA_API_ERROR` / `INVALID_PARAMS` / `TOKEN_REJECTED` / `UNKNOWN_ACTION` / `READBACK_MISMATCH`
