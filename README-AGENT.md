# For Agent · Chat Tools 0.1.11

先读 [README](README.md#for-agent)。目标是 Windows x64 Microsoft Store `OpenAI.Codex` 客户端，依赖本机 CDP 和内部页面能力；客户端更新可能需要适配。

## 入口与排查

| 文件 | 职责 |
| --- | --- |
| `chat-tools.ps1` / `chat-tools-monitor.cjs` | 面板、托盘、单实例、自有 worker 生命周期及异常恢复 |
| `start-debug.ps1` / `desktop-connection.cjs` | Store 启动、本机连接与主页面筛选 |
| `question-timeline.cjs` / `timeline-*.js/cjs` | 索引安装、消息适配、模块发现、历史补载与诊断 |
| `annotate-chat.cjs` / `annotations-*.js/cjs` | 标注安装、选区与公式、存储、历史定位、分支继承与删除 |

文件均在 `app/`。运行路径相对工具目录解析；内置 Node.js v25.2.1 x64，许可见 `app/runtime/Node-LICENSE.txt`。源码构建与回归入口见仓库 `BUILD.md`。

排查顺序：完整解压和目录可写 → README 中的 CheckOnly → `combined-status.json` 的时间及 workerPid → 本机端点 → 页面就绪 → 模块/定位能力 → 单条原文匹配。诊断和偏好在 `app/data/`；`worker-events.jsonl` 保留异常退出与恢复事件。日志只记录数量、能力和安全错误类型；不要导出正文、批注、对话 ID、账号或令牌。

只连接 `http://127.0.0.1:39223`，WebSocket 必须同端口 loopback；过滤 overlay，仅选 `app://-/index.html`。普通启动的客户端无法靠现有入口现场补开调试参数。不要为排查结束用户客户端、发送消息或创建/删除对话。

## 适配要点

- **启动与监视**：应用可见界面就绪后才导入原生模块、安装监听，避免干扰启动页。每轮重新枚举窗口，两项失败相互隔离；单轮异常继续重试，自有 worker 异常退出约 5 秒后恢复。父 PID 消失或 session 停止时退出；手动退出不重启，只回收自己持有的进程。
- **历史**：按能力发现当前模块和分页状态，不能固定 minified 导出名。历史能力缺失的已安装目录约 30 秒重试；安装成功不代表历史完整。标注只复用 Timeline 已加载的消息身份和原生跳转，不额外请求历史或调用模型。
- **定位**：消息身份必须唯一；历史跳转后再次核对原文、offset 和上下文。切换对话取消待完成跳转。Codex 仍依赖已渲染回答；不能放宽匹配规则来点亮灰色条目。
- **分支**：只复制明确祖先路径上保留的消息，生成独立标注 ID；书签按稳定 user message ID 重映射刻度。分别记录继承完成，重复事件不能恢复用户已删除的副本。身份 resolver 可位于 app-initial 或 app-shared，均需验证契约；恢复已有草稿的 identity watch，覆盖临时 ID 转正式 ID 和助手重载。
- **删除**：只在原生操作确认删除后清理；保存 tombstone 阻止延迟写回，跨窗口同步。归档、列表缺项、返回和窗口关闭不算删除，临时分支没有自动过期。原对话删除不影响分支副本。
- **公式与显示**：公式作为完整锚点，MathML 按白名单重建；旧文字记录沿用旧定位。预览只测量自身 DOM，不修改原回答；三行按真实排版截取，公式不拆分，导航按 grapheme 边界省略。UI 用 Shadow DOM，保留原生浮层覆盖能力。
- **Windows UI**：创建 handle 前设置 Per Monitor V2；WinForms 的 Dpi 模式先于 96dpi 设计基准设置。托盘保持原生 ContextMenu，单击左键打开面板；退出仅在右键菜单。不要用放大位图掩盖 DPI 问题。

## 数据与发布

书签使用 `question-timeline:bookmarks:v1:`，锚点使用 `question-timeline:bookmark-anchors:v1:`，左右偏好使用 `question-timeline:side:v1`；标注使用 `chat-annotations:v1:`，另有 identity/deleted 标记。数据保存在客户端 localStorage，不随工具 ZIP 迁移。保留原格式；不要复制登录目录或按文本相似度猜测跨对话归属。

仅维护合并版 `app/`，不要回改旧独立版本。修改后运行相关模拟回归、JS/PowerShell 语法及 GUI CheckOnly；在中文空格路径验证便携包的校验和与运行时。实际验收关注多窗口/刷新、三行与公式、标注历史跳转、分支临时 ID 转正式 ID、删除副本独立性及原生浮层。区分模拟通过、只读检查和桌面端实测。

打包使用源码白名单，不包含 `app/data/`、日志、账号目录、机器绝对路径、客户端提取资源或开发探针。重建 `app/SHA256SUMS.txt`。Windows PowerShell 源码必须保留 UTF-8 BOM。
