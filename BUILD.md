# Build and validation

The repository contains source code. The ready-to-use Windows package is available
from [Releases](https://github.com/Sierra014/timeline-for-gpt-desktop-chat/releases/latest).
The release ZIP includes the runtime and all launch files described in README.

## Build on Windows x64

Use Python 3.9+ and the official **Node.js v25.2.1 Windows x64** distribution.
Pass the path to its `node.exe`:

```powershell
python .\tools\build-portable.py --node "C:\path\to\node.exe"
```

The output is in `dist/`. The packager copies only the explicit source allowlist,
adds the bundled Node runtime and its third-party license, and creates checksums.
Logs, preferences, private client resources and development fixtures are excluded.
The top-level launch files also work from a source checkout after placing that
runtime at `app/runtime/node.exe`.

## Regression checks

These tests use synthetic state and do not open or change a desktop client:

```powershell
node .\tests\test-tray-monitor.cjs
node --experimental-vm-modules .\tests\test-update-attempt.cjs
```

Follow README's **For Agent** section for read-only client checks and actual UI
validation. Keep Chinese PowerShell source in UTF-8 with a BOM. Validate release
extraction under a path containing Chinese characters and spaces. Before a new
release, update the tool version and the README to match the packaged runtime.
