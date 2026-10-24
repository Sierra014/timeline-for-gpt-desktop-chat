from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description="Build Chat Tools for Windows x64.")
parser.add_argument("--node", type=Path, required=True,
                    help="Official Node.js v25.2.1 Windows x64 node.exe")
args = parser.parse_args()
node = args.node.resolve(strict=True)
metadata = json.loads(subprocess.check_output([str(node), "-p",
    "JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})"], text=True))
if metadata != {"version": "v25.2.1", "arch": "x64", "platform": "win32"}:
    parser.error("Expected Node.js v25.2.1 Windows x64.")

version = re.search(r"const version = '([^']+)'",
                    (root / "app/chat-tools-monitor.cjs").read_text(encoding="utf-8")).group(1)
name = "chat-tools-windows-x64-v" + version
target = root / "dist" / name
sources = {
    "chat-tools.ps1", "chat-tools-monitor.cjs", "start-debug.ps1", "desktop-connection.cjs",
    "question-timeline.cjs", "timeline-runtime.js", "timeline-chat-adapter.cjs",
    "timeline-native-resolver.cjs", "timeline-monitor.cjs", "timeline-diagnostics.cjs",
    "timeline-paths.cjs", "timeline-compatibility.json", "inspect-chat.cjs", "check-compatibility.cjs",
    "annotate-chat.cjs", "annotations-adapter.js", "annotations-runtime.js",
    "annotations-store.js", "annotations-lifecycle.js", "annotations-monitor.cjs",
    "assets/pen.ico", "runtime/Node-LICENSE.txt",
}
files = {"app/" + file for file in sources}
files.update({"README.md", "README-AGENT.md", "Start Chat Tools.vbs"})
if target.exists():
    shutil.rmtree(target)
# The ZIP uses this allowlist even if dist contains files from an older build.
for file in sorted(files):
    destination = target / file
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / file, destination)
annotation_version = re.search(r"const version = '([^']+)'",
    (target / "app/annotate-chat.cjs").read_text(encoding="utf-8")).group(1)
assert "const version = '" + annotation_version + "'" in (target / "app/annotations-runtime.js").read_text(encoding="utf-8")
for file in files:
    if file.endswith(".ps1"):
        assert (target / file).read_bytes().startswith(b"\xef\xbb\xbf"), file
shutil.copy2(node, target / "app/runtime/node.exe")
files.add("app/runtime/node.exe")
checksums = "".join(hashlib.sha256((target / file).read_bytes()).hexdigest() + "  " + file + "\n"
                    for file in sorted(files))
(target / "app/SHA256SUMS.txt").write_text(checksums, encoding="utf-8")
files.add("app/SHA256SUMS.txt")
archive = root / "dist" / (name + ".zip")
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for file in sorted(files):
        bundle.write(target / file, name + "/" + file)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.parent / (archive.name + ".sha256")).write_text(digest + "  " + archive.name + "\n", encoding="ascii")
print(json.dumps({"archive": str(archive), "files": len(files), "sha256": digest}))
