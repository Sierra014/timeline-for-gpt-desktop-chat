# Build and validation

源码位于 `app/`。直接使用请下载 [Release 便携 ZIP](https://github.com/Sierra014/timeline-for-gpt-desktop-chat/releases/latest)，包含运行时和许可证。

## 构建

Windows x64，Python 3.9+，官方 **Node.js v25.2.1 Windows x64**：

```powershell
python .\tools\build-portable.py --node "C:\path\to\node.exe"
```

输出在 `dist/`：便携文件夹、ZIP 和 ZIP 的 SHA-256 文件。仅复制明确列出的源码、文档、图标和运行时，不打包本地数据或日志。源码目录直接运行时，需另将上述 `node.exe` 放入 `app/runtime/`。

## 验证

在仓库根目录执行。这些回归使用模拟状态或暂停状态的隔离 worker，不安装工具、不改动客户端：

```powershell
node .\tests\test-chat-tools-monitor.cjs
node .\tests\test-timeline-history-recovery.cjs
node .\tests\test-worker-recovery.cjs
node --experimental-vm-modules .\tests\test-update-attempt.cjs
python .\tests\test-portable.py
```

最后一项需先构建，验证白名单、校验和、中文空格路径、内置 Node 语法、GUI CheckOnly 及 worker 停止机制。源码适配规则见 [README-AGENT.md](README-AGENT.md)；桌面端行为仍需按实际改动验收。
