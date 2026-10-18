from pathlib import Path
import hashlib,json,os,re,subprocess,tempfile,time,zipfile
root=Path(__file__).resolve().parent.parent
version=re.search(r"const version = '([^']+)'",(root/'app/chat-tools-monitor.cjs').read_text(encoding='utf-8')).group(1)
name='chat-tools-windows-x64-v'+version
archive=root/'dist'/(name+'.zip')
destination=Path(tempfile.mkdtemp(prefix='合并工具 迁移验证 ',dir=root/'dist'))
expected={'README.md','README-AGENT.md','启动 对话工具.cmd','启动 对话工具.vbs'}|{
 'app/'+file for file in ('chat-tools-monitor.cjs','chat-tools.ps1','question-timeline.cjs',
 'timeline-runtime.js','timeline-chat-adapter.cjs','timeline-native-resolver.cjs',
 'timeline-monitor.cjs','timeline-diagnostics.cjs','timeline-paths.cjs','timeline-compatibility.json',
 'inspect-chat.cjs','check-compatibility.cjs','annotate-chat.cjs','annotations-adapter.js',
 'annotations-runtime.js','annotations-store.js','annotations-lifecycle.js','annotations-monitor.cjs','desktop-connection.cjs','start-debug.ps1',
 'runtime/node.exe','runtime/Node-LICENSE.txt','SHA256SUMS.txt','assets/pen.ico')}
with zipfile.ZipFile(archive) as package:
 assert set(package.namelist())=={name+'/'+file for file in expected}
 package.extractall(destination) # Exact allowlist excludes absolute paths, traversal and user data.
relocated=destination/name
checksums=(relocated/'app/SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
assert {line.split('  ',1)[1] for line in checksums}==expected-{'app/SHA256SUMS.txt'}
for line in checksums:
 digest,file=line.split('  ',1);assert hashlib.sha256((relocated/file).read_bytes()).hexdigest()==digest,file
runtime=relocated/'app/runtime/node.exe'
for file in sorted(expected):
 if file.endswith(('.js','.cjs')):subprocess.run([str(runtime),'--check',str(relocated/file)],check=True)
 if file.endswith('.ps1'):assert (relocated/file).read_bytes().startswith(b'\xef\xbb\xbf')
 if file.endswith('.cmd'):
  script=(relocated/file).read_bytes();assert b'%~dp0' in script and b'\r\n' in script
  assert b'D:\\' not in script and b'C:\\Users' not in script
assert 'chat-tools.ps1' in (relocated/'启动 对话工具.vbs').read_text(encoding='ascii')
control=subprocess.check_output(['powershell.exe','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',
 str(relocated/'app/chat-tools.ps1'),'-CheckOnly'],text=True)
assert 'No client or worker launched' in control
assert 'DPI awareness: 2' in control and 'font: Microsoft YaHei UI' in control
assert not (relocated/'app/data').exists(),'CheckOnly must not create preferences or a worker'
# Exercise the relocated backend with both features paused: read-only client checks only.
folder=relocated/'app/data';folder.mkdir()
session='b'*32
prefs={'enabled':False,'timelineEnabled':False,'generation':0,'timelineGeneration':0,
 'removeGeneration':0,'timelineRemoveGeneration':0,'side':None,'stopSession':''}
preferences=folder/'preferences.json';preferences.write_text(json.dumps(prefs),encoding='utf-8')
process=subprocess.Popen([str(runtime),str(relocated/'app/chat-tools-monitor.cjs'),
 '--parent='+str(os.getpid()),'--session='+session],stdout=subprocess.PIPE,stderr=subprocess.PIPE,
 creationflags=subprocess.CREATE_NO_WINDOW)
try:
 status={};deadline=time.monotonic()+40
 while time.monotonic()<deadline:
  if process.poll() is not None:raise AssertionError('Monitor exited: '+process.communicate()[1].decode())
  try:status=json.loads((folder/'combined-status.json').read_text(encoding='utf-8'))
  except (FileNotFoundError,json.JSONDecodeError):pass
  if status.get('timeline',{}).get('phase')=='paused' and status.get('annotations',{}).get('phase')=='paused':break
  time.sleep(.2)
 assert status['timeline']['phase']=='paused' and status['annotations']['phase']=='paused',status
 assert status['workerPid']==process.pid
 prefs['stopSession']=session;preferences.write_text(json.dumps(prefs),encoding='utf-8')
 stdout,stderr=process.communicate(timeout=20);assert process.returncode==0,stderr.decode()
 logfile=folder/'timeline-diagnostics.jsonl'
 if logfile.exists():assert 'installation-result' not in logfile.read_text(encoding='utf-8')
 print(json.dumps({'passed':True,'files':len(expected),'checksums':len(checksums),
  'unicodeAndSpacePath':True,'controlWindow':control.strip(),'singleWorkerBothPaused':True,
  'sessionExit':True,'noClientInstallations':True},indent=2))
finally:
 if process.poll() is None:process.kill();process.wait(timeout=5)
