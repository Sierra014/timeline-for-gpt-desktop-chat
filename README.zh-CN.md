[English](README.md) | **简体中文**

# ChatGPT 桌面端 Timeline 与标注

为长 ChatGPT 对话增加可视化 Timeline、书签、高亮和本地批注。

## 使用

从 [Releases](https://github.com/Sierra014/timeline-for-gpt-desktop-chat/releases/latest) 下载 Windows x64 便携 ZIP，完整解压，双击 **Start Chat Tools.vbs**，即可打开 GPT 并加载 Timeline 和 Annotation。无需另装 Node.js。

- **Timeline**：悬浮刻度预览提问和回答，点击跳转；预览支持加粗、公式，回答显示三行，公式保持完整。
- 点击预览卡片的书签图标收藏轮次；当前可见轮次和书签会加深显示。索引可放在左侧或右侧，边距不足自动隐藏。
- **Annotation**：点击右上角画笔进入标注模式，选中文字或公式，选择颜色、填写批注并保存；再次点击退出，恢复原生选取。
- 悬浮高亮查看批注，点击编辑；悬浮右上角书签打开标注导航，点击跳转。灰色条目暂时无法定位。
- 分支会继承分支点及之前保留内容的书签和标注，保存为独立副本；修改或删除原对话不影响副本。需要在工具已加载时创建分支。
- 一个运行窗口管理两项功能，可分别开关、重新加载或移除并暂停；新窗口和页面刷新会自动加载。关闭面板收起到托盘，单击托盘图标重新打开，退出在托盘右键菜单中。

适用于 Microsoft Store `OpenAI.Codex` 客户端：ChatGPT 使用两项功能，Codex 使用标注并保留原生索引。独立 ChatGPT Windows 应用未验证。

升级时先从托盘退出旧助手，再启动新版。若 GPT 已经普通启动且助手一直等待连接，请从客户端托盘完全退出，再由工具打开；当前仍需要带调试参数启动。

## 隐私与本地存储

书签、高亮、批注和左右偏好保存在客户端本地；工具不发送批注、不调用模型。复制整个文件夹可以迁移工具，**不会迁移书签和标注**，目前没有跨设备同步。运行偏好与诊断在 `app/data/`。

工具观察到客户端确认删除对话后，会清理其本地记录；未发送消息的临时分支不会因返回或关闭窗口而自动清理。未加载历史、折叠思考或原文已变化时，标注可能无法定位。

## For Agent

如果下载后无法正常使用，可以让 Codex 根据以下信息检查兼容性。

先运行和检查能力，再根据日志适配；不要仅按客户端版本号拒绝运行。

- `app/chat-tools.ps1` 管理面板、托盘和 worker；`app/chat-tools-monitor.cjs` 管理两项功能；`app/start-debug.ps1` 动态解析当前 Store 安装位置。
- `app/timeline-*.js/cjs` 负责索引、原生历史和定位；`app/annotations-*.js/cjs` 负责高亮、本地存储及分支/删除监听。合并版是唯一维护入口。
- CDP 仅连接 `127.0.0.1:39223`，仅操作 `app://-/index.html` 主页面，等待应用就绪后安装。不要结束用户客户端或对外转发端口。

在解压包根目录执行，只检查配置和能力，不安装工具、不滚动、不发消息：

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\app\chat-tools.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\app\start-debug.ps1 -CheckOnly
& .\app\runtime\node.exe .\app\check-compatibility.cjs
& .\app\runtime\node.exe .\app\annotate-chat.cjs --check
& .\app\runtime\node.exe .\app\inspect-chat.cjs
```

优先检查 `app/data/combined-status.json`、`app/data/worker-events.jsonl` 和启动日志。连接成功不等于安装或历史补载成功；核对 `installed`、`failed` 与历史能力。更多定位与存储约束见 [README-AGENT.md](README-AGENT.md)，源码构建见 [BUILD.md](BUILD.md)。

修改后检查 JS 语法、Windows PowerShell 5.1 解析和真实界面；中文 PowerShell 保持 UTF-8 BOM。发布只包含源码白名单、运行时和校验表，不包含 `data`、日志、聊天、账号或提取的客户端资源。
