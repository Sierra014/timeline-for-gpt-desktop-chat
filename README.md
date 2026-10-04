# Chat Timeline · Windows 便携版 0.1.3

## For User

解压完整文件夹，双击 **启动 Timeline.vbs**，即可打开 GPT 并自动显示对话索引。也可使用 **启动 Timeline.cmd**。

- 悬浮刻度预览提问和回答，点击可以跳转。
- 点击预览卡片的书签图标收藏轮次；在刻度上, 会加深显示当前页面的轮次和书签。
- 可以按习惯选择把timeline放在左侧或右侧，边距不足会自动隐藏。
- 书签和左右偏好记在客户端本地；托盘偏好与诊断记在 `app/data`，后续使用会恢复。
- 托盘支持打开 GPT、重新加载和暂停自动安装；助手挂着时，从GPT里打开的新窗口和页面刷新会自动安装索引。

升级时从托盘退出旧助手，再启动新版。复制整个文件夹即可迁移工具；在新电脑登录自己的客户端账号。书签属于原电脑的客户端本地数据。

## For Agent

这部分供 Codex 调试和适配。先阅读，再按实际日志判断；客户端更新后先尝试运行和检查能力，不按版本号拒绝。

### 运行条件与启动

目标是 Windows x64 的 Microsoft Store `OpenAI.Codex` 客户端中的 ChatGPT 对话界面，包族 `OpenAI.Codex_2p2nqsd0c76g0`。独立 ChatGPT Windows 客户端未验证。原始完整界面实测于 Store `26.930.2377.0`；新版模块解析使用本机 Store `26.930.3930.0` / 应用构建 `26.930.31730` 的文件验证。这些版本是诊断参考，没有白名单限制。

启动器通过当前用户 Store 注册信息解析安装位置、App ID，以 `--remote-debugging-address=127.0.0.1 --remote-debugging-port=39223` 启动。CDP 只连本机端口，禁止转发到网络。客户端原生历史读取可能访问其正常服务；工具无需 API Key，也不上传聊天正文。

普通模式已运行的客户端无法现场补开启动参数，需要用户从客户端托盘完全退出后通过 Timeline 入口重开。避免结束用户正在使用的客户端。窗口关闭后若客户端留在后台，已有调试连接可以复用。助手退出保留客户端及已显示的索引。

托盘以命名 mutex/event 保证单实例；重复启动入口通知原助手打开 GPT。后台每约两秒检查窗口、版本和运行异常，断线等待重连，失败约 30 秒后重试，手动重新加载可立即重试。子进程通过 parent PID 和 session 停止；退出助手仅回收它拥有的监视进程。

### 文件与数据

顶层只有两个启动入口和本 README；`app/` 包含源码、运行时和校验表。内置 Node.js **v25.2.1 Windows x64**，许可位于 `app/runtime/Node-LICENSE.txt`。所有路径相对工具目录解析，支持中文和空格。

| 文件 | 职责 |
| --- | --- |
| `timeline-tray.ps1` / `start-debug.ps1` | 托盘、启动和当前用户 Store 定位 |
| `timeline-monitor.cjs` | 自动安装、重连、异常导出和进程生命周期 |
| `question-timeline.cjs` | 安装/移除入口、多窗口筛选 |
| `timeline-runtime.js` | 刻度、预览、书签、布局和可见轮次标记 |
| `timeline-chat-adapter.cjs` | 内部消息状态、定位和历史加载适配 |
| `timeline-native-resolver.cjs` / `timeline-compatibility.json` | 动态模块发现、能力检查及参考模块名 |
| `inspect-chat.cjs` / `check-compatibility.cjs` | 只读统计、能力检查和运行诊断导出 |
| `timeline-diagnostics.cjs` / `timeline-paths.cjs` | 安全诊断、文件存放及旧位置数据复制 |
| `SHA256SUMS.txt` | 按包根目录相对路径列出的 SHA-256 校验值 |

运行生成的文件放在 `app/data/`：

- `tray-preferences.json`：enabled、side、generation、removeGeneration、stopSession；side 为空时使用客户端已有偏好。退出时的 stopSession 只作用于当次监视进程。
- `tray-status.json`：连接阶段、窗口数、安装数和失败数。
- `tray-launch.log` / `tray-launch-error.log` / `tray-launch-result.json`：启动输出、错误与最终判定。结果同时记退出码和 endpointReady；判断误报时核对实际连接。PowerShell 的空退出码曾导致已成功启动仍提示失败，0.1.3 保留进程 handle 并复查本地端点。
- `tray-monitor-*.log` / `tray-bootstrap-error.log`：后台和托盘启动诊断。
- `timeline-diagnostics.jsonl` / `timeline-result.json` / `compatibility-result.json` / `probe-result.json` / `probe-history.jsonl`：适配诊断、安装结果和只读统计。

诊断仅存能力、数量、模块路径和错误类型，不记录聊天正文、对话 ID、账号、令牌或原始异常。JSONL 超过约 1 MB 轮换为 `.previous`。客户端运行诊断最多 80 条，后台导出新增记录；助手关闭后的运行错误可用只读检查导出。运行结果文件也应先检查内容再分享。

书签保存轮次 ID，位于原客户端 localStorage 的 `question-timeline:bookmarks:v1:<context>`；左右偏好键是 `question-timeline:side:v1`，运行诊断键是 `question-timeline:diagnostics:v1`。它们不随工具 ZIP 迁移，也不要通过复制登录目录来迁移。需要保留托盘偏好时，从旧包复制 `tray-preferences.json` 到新版 `app/data/`。原位置就地升级时自动复制同名旧数据到新的 data 目录；保留旧文件和已有新文件。

### 调试步骤

在包根目录用 PowerShell 执行以下命令。第一组只检查本地启动配置和托盘构建，不打开客户端、不安装索引：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\app\start-debug.ps1 -CheckOnly
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\app\timeline-tray.ps1 -CheckOnly
```

用户通过启动入口打开客户端，并打开目标 ChatGPT 对话后，可只读检查：

```powershell
& .\app\runtime\node.exe .\app\check-compatibility.cjs
& .\app\runtime\node.exe .\app\inspect-chat.cjs
```

这些检查读取统计和内部能力，不滚动、不补载历史、不发送消息。能力检查同时导出客户端已存的运行错误。需要实际安装/更新或移除时，使用托盘；手动调试入口如下（安装模式要求恰好一个可识别目标对话窗口）：

```powershell
& .\app\runtime\node.exe .\app\question-timeline.cjs --side=left
& .\app\runtime\node.exe .\app\question-timeline.cjs --side=right
& .\app\runtime\node.exe .\app\question-timeline.cjs --remove
```

移除前暂停托盘自动安装，否则后台会恢复索引。优先收集 data 中的诊断、启动结果和状态；端点不可用先检查普通启动残留进程及启动日志。端点就绪且 installed > 0、failed = 0 时，启动提示不代表安装失败。不要为排查导出聊天正文、登录资料或整个客户端目录。

### 适配边界与更新

CDP 仅选择 `app://-/index.html` 主页面，过滤原生浮层窗口。ChatGPT 消息适配从 `.thread-scroll-container`、`[data-turn-key]` 和 React props 读取 user-message / assistant-message，验证 ChatGPT context 与内部 `scrollToKey`、`getEntryGeometry` 等实际能力后安装。检查函数中的属性访问只读取统计，不导出正文。

参考模块名优先尝试；失效后从当前入口与已加载资源寻找 history 模块、状态 atom 和实际导出名。历史读取使用原生 source.search 与 scope.get 的分页状态；缺少模块时显示已加载轮次，随着聊天滚动补充。DOM、React 或内部定位入口改变时需要修改适配器。模块解析成功不等于所有 UI 行为都已实测通过。

预览使用安全的 Markdown 子集，原生 KaTeX 渲染有长度约束并关闭 trust，提取安全 MathML；公式能力缺失时保留源码。UI 使用 Shadow DOM，在主内容的层叠上下文内挂载，保证原生侧栏预览和其他浮层可以覆盖。更新后验证左右边距、可见多轮标记、悬浮及卡片间移动、跳转、历史补载、书签恢复、公式、长目录滚动和原生浮层覆盖。

修改后检查 JS 语法、Windows PowerShell 5.1 解析和实际运行；中文 PowerShell 源码保持 UTF-8 BOM。数据迁移只复制，不删除用户文件。打包按源码白名单加入文件，不包含 data、日志、聊天、账号、开发测试、客户端提取资源或机器绝对路径。重建 `SHA256SUMS.txt`，在含中文与空格的新路径验证运行时和生命周期。

官方插件 UI 提供 MCP Apps iframe 与桥接接口；本工具依赖的宿主消息列表读取和原生定位接口尚未见于所查文档。改为插件入口仍需评估内部适配方式。参考：[官方插件 UI 文档](https://developers.openai.com/plugins/build/chatgpt-ui)、[官方扩展能力](https://developers.openai.com/plugins/build/extensions)。
