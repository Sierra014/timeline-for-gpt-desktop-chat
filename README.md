**English** | [简体中文](README.zh-CN.md)

# Timeline for ChatGPT Desktop

Navigate long ChatGPT conversations with a visual timeline, bookmarks, highlights, and local annotations.

Designed for the Windows desktop client, this project makes long conversations easier to revisit without repeatedly scrolling through dozens of turns.

## Features

### Timeline

- Hover over timeline markers to preview the corresponding question and answer.
- Click a marker to jump directly to that turn.
- Previews support bold text and formulas; answer previews show multiple lines while keeping formulas intact.
- The timeline can be placed on the left or right side of the conversation.
- It hides automatically when there is not enough horizontal space.

### Bookmarks

- Bookmark important conversation turns directly from the preview card.
- The currently visible turn and bookmarked turns are visually emphasized.
- Use bookmarks as persistent waypoints inside long conversations.

### Annotations

- Enter annotation mode from the pen button.
- Select text or formulas, choose a highlight color, add a note, and save it.
- Hover over a highlight to inspect its note; click it to edit.
- Open the annotation navigator from the bookmark control and jump back to saved annotations.
- Gray entries indicate annotations that cannot currently be located in the loaded conversation.

### Branch-aware notes

When a branch is created while the tool is loaded, bookmarks and annotations from the preserved part of the parent conversation are inherited into an independent copy.

Later edits or deletion of the original conversation do not modify that copied branch data.

### One helper for both tools

Timeline and Annotation are managed from one helper window. Each feature can be enabled, reloaded, removed, or paused independently.

New app windows and page refreshes are handled automatically. Closing the helper panel sends it to the system tray; click the tray icon to reopen it.

## Installation

1. Open [Releases](https://github.com/Sierra014/timeline-for-gpt-desktop-chat/releases/latest).
2. Download the Windows x64 portable ZIP.
3. Extract the ZIP completely.
4. Double-click **`Start Chat Tools.vbs`** to launch the helper and open the client with Timeline and Annotation loaded.

A separate Node.js installation is **not** required.

### Upgrading

Exit the old helper from the system tray before starting a newer version.

If the desktop client is already running normally and the helper keeps waiting for a connection, fully exit the client from its tray menu and let the helper launch it again.

The client currently still needs to be launched with debugging enabled.

## Compatibility

| Client | Timeline | Annotation | Status |
| --- | --- | --- | --- |
| ChatGPT in the Microsoft Store `OpenAI.Codex` package | Yes | Yes | Supported target |
| Codex in the same package | Native index retained | Yes | Supported |
| Standalone ChatGPT Windows app | Not verified | Not verified | Testing needed |

The project checks capabilities instead of refusing to run solely based on the desktop client version.

## Privacy and local storage

Bookmarks, highlights, annotations, and timeline-side preferences are stored locally.

The tool does **not** send annotation content to a model and does **not** make model calls.

Its CDP connection is limited to `127.0.0.1:39223` and operates on the desktop client's main `app://-/index.html` page.

Runtime preferences and diagnostics are stored under `app/data/`.

Copying the project folder moves the tool itself, but **does not migrate bookmarks or annotations**. Cross-device sync is not currently implemented.

When the tool observes a confirmed conversation deletion in the client, it cleans up the corresponding local records. Unsent temporary branches are not automatically removed simply because you navigate away or close the window.

Annotations may temporarily fail to locate their source when history has not been loaded, reasoning content is collapsed, or the original text has changed.

## Agent-assisted compatibility checks

The repository includes diagnostics intended to make compatibility fixes easier when the desktop client changes.

From the extracted project root, the following commands check configuration and capabilities without installing the tool, scrolling the conversation, or sending a message:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\app\chat-tools.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\app\start-debug.ps1 -CheckOnly
& .\app\runtime\node.exe .\app\check-compatibility.cjs
& .\app\runtime\node.exe .\app\annotate-chat.cjs --check
& .\app\runtime\node.exe .\app\inspect-chat.cjs
```

Useful diagnostics include:

- `app/data/combined-status.json`
- `app/data/worker-events.jsonl`
- launcher logs

A successful local debugging connection does not by itself mean that feature installation or history backfilling succeeded. Check the reported `installed`, `failed`, and history capability states.

For implementation details, storage behavior, and locator constraints, see [README-AGENT.md](README-AGENT.md). For building from source, see [BUILD.md](BUILD.md).

## Project structure

- `app/chat-tools.ps1` — helper panel, system tray, and worker management
- `app/chat-tools-monitor.cjs` — combined Timeline and Annotation management
- `app/timeline-*.js/cjs` — timeline rendering, native history integration, and navigation
- `app/annotations-*.js/cjs` — highlights, local storage, branch handling, and deletion tracking
- `app/start-debug.ps1` — resolves the installed Store package and launches it with local debugging enabled

The combined implementation is the maintained entry point.

## Feedback

If you regularly keep long ChatGPT conversations, feedback on navigation, annotation workflows, compatibility, and edge cases is especially useful.
