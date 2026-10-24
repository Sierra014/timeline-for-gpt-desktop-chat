# Chat Tools: Timeline & Annotations for ChatGPT Desktop

English | [简体中文](README.zh-CN.md)

A local Windows companion for navigating and annotating long conversations in the Microsoft Store `OpenAI.Codex` client. Add a timeline, bookmarks, highlights, and notes to ChatGPT. The control panel supports English and Chinese.

## For User

### Install and launch

1. Download the Windows x64 portable ZIP from [Releases](https://github.com/Sierra014/timeline-for-gpt-desktop-chat/releases/latest).
2. Extract the entire archive.
3. Double-click **Start Chat Tools.vbs** to open the client and load Timeline and Annotations.

The portable ZIP includes Node.js; no separate Node.js installation is required.

### Features

- **Timeline:** Hover over the floating rail to preview questions and answers, then click to jump to a turn. Previews support bold text and formulas. Answer previews show three lines while keeping formulas intact.
- **Bookmarks:** Click the bookmark icon on a preview card to save a turn. Bookmarked turns and the currently visible turn appear darker on the rail. Place the rail on the left or right; it hides automatically when there is not enough margin.
- **Annotations:** Click the pen in the upper-right corner to enter annotation mode. Select text or a formula, choose a color, add a note, and save. Click the pen again to exit and restore normal text selection.
- **Annotation navigation:** Hover over a highlight to read its note, or click to edit it. Hover over the bookmark in the upper-right corner to open annotation navigation, then click an entry to jump to it. Gray entries cannot currently be located.
- **Conversation branches:** New branches inherit bookmarks and annotations for content retained through the branch point as independent copies. Editing or deleting the original conversation does not affect those copies. Create the branch while the tools are loaded.
- **One control panel:** Enable or disable each feature, reload it, or remove it and pause automatic loading. New windows and page refreshes load the tools automatically. Closing the panel minimizes it to the tray; click the tray icon to reopen it. Use the tray's right-click menu to quit.

### Compatibility and updates

This tool targets the Microsoft Store `OpenAI.Codex` client on Windows x64. ChatGPT uses both features; Codex uses Annotations and keeps its native conversation index. The standalone ChatGPT Windows app has not been verified.

Before upgrading, quit the old helper from its tray menu, then launch the new version. If the client is already running normally and the helper keeps waiting for a connection, fully quit the client from its tray menu and launch it through the tool. The client currently needs to start with debugging enabled.

### Local data and limitations

Bookmarks, highlights, notes, and left/right preferences are saved locally in the client. The tool does not transmit annotations or call AI models. Copying the tool folder moves the tool, but **does not move bookmarks or annotations**. Cross-device synchronization is not available. Runtime preferences and diagnostics are stored in `app/data/`.

After the tool observes a confirmed conversation deletion in the client, it removes the corresponding local records. Temporary branches with no sent messages are not automatically cleaned up when you go back or close a window. Annotations may be impossible to locate if history has not loaded, reasoning is collapsed, or the original text has changed.

If the download does not work for you, ask Codex to help adapt it. The section below is intended for agents.

## For Agent

Run the tool and check capabilities before adapting it from logs. Do not reject a client solely because of its version number.

- `app/chat-tools.ps1` manages the panel, tray, and worker. `chat-tools-monitor.cjs` manages both features. `start-debug.ps1` dynamically resolves the current Store installation.
- `timeline-*.js/cjs` handles the index, native history, and navigation. `annotations-*.js/cjs` handles highlights, local storage, and branch/deletion listeners. Maintain only the combined version.
- Connect CDP only to `127.0.0.1:39223` and operate only on the main `app://-/index.html` page. Wait until the application is ready before installing the tools. Do not terminate the user's client or forward the port externally.

From the extracted package root, run these read-only configuration and capability checks. They do not install the tools, scroll, or send messages:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\app\chat-tools.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\app\start-debug.ps1 -CheckOnly
& .\app\runtime\node.exe .\app\check-compatibility.cjs
& .\app\runtime\node.exe .\app\annotate-chat.cjs --check
& .\app\runtime\node.exe .\app\inspect-chat.cjs
```

Start with `app/data/combined-status.json`, `worker-events.jsonl`, and the startup logs. A successful connection does not prove installation or history loading succeeded; check `installed`, `failed`, and history capabilities. See [README-AGENT.md](README-AGENT.md) for navigation and storage constraints, and [BUILD.md](https://github.com/Sierra014/timeline-for-gpt-desktop-chat/blob/main/BUILD.md) for source builds.

After code changes, check JavaScript syntax, Windows PowerShell 5.1 parsing, and the actual UI. Keep Chinese PowerShell files encoded as UTF-8 with BOM. Releases must include only the source allowlist, runtime, and checksum manifest; exclude `data`, logs, chats, accounts, and extracted client resources.
