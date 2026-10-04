from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description='Build the Windows x64 portable distribution.')
parser.add_argument('--node', type=Path, required=True, help='Official Node.js v25.2.1 Windows x64 node.exe')
args = parser.parse_args()
node = args.node.resolve(strict=True)
metadata = json.loads(subprocess.check_output([str(node), '-p',
    'JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})'], text=True))
if metadata != {'version': 'v25.2.1', 'arch': 'x64', 'platform': 'win32'}:
    parser.error('Expected Node.js v25.2.1 Windows x64 to match the documented release runtime.')

version = json.loads((root / 'app/timeline-compatibility.json').read_text(encoding='utf-8'))['toolVersion']
name = 'chat-timeline-windows-x64-v' + version
target = root / 'dist' / name
(target / 'app/runtime').mkdir(parents=True, exist_ok=True)
sources = [
    'question-timeline.cjs', 'timeline-runtime.js', 'timeline-chat-adapter.cjs',
    'timeline-compatibility.json', 'check-compatibility.cjs', 'timeline-native-resolver.cjs',
    'timeline-diagnostics.cjs', 'timeline-paths.cjs', 'inspect-chat.cjs',
    'start-debug.ps1', 'timeline-monitor.cjs', 'timeline-tray.ps1',
]
files = {'app/' + name for name in sources}
files.update(['README.md', '启动 Timeline.vbs', '启动 Timeline.cmd', 'app/runtime/Node-LICENSE.txt'])
# Explicit allowlist excludes local data, development files and client resources.
for file in sorted(files):
    shutil.copy2(root / file, target / file)
shutil.copy2(node, target / 'app/runtime/node.exe')
files.add('app/runtime/node.exe')
checksums = ''.join(hashlib.sha256((target / file).read_bytes()).hexdigest() + '  ' + file + '\r\n'
                    for file in sorted(files))
(target / 'app/SHA256SUMS.txt').write_bytes(checksums.encode('utf-8'))
files.add('app/SHA256SUMS.txt')
archive = root / 'dist' / (name + '.zip')
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for file in sorted(files):
        bundle.write(target / file, Path(name) / file)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(archive.parent / (archive.name + '.sha256')).write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
print(json.dumps({'archive': str(archive), 'files': len(files), 'sha256': digest}))
