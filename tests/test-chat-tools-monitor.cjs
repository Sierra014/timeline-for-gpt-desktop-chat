'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createMonitor,defaults}=require('../app/chat-tools-monitor.cjs');
const {createMonitor:createAnnotations}=require('../app/annotations-monitor.cjs');
const {createMonitor:createTimeline}=require('../app/timeline-monitor.cjs');
(async()=>{
 const dataFolder=fs.mkdtempSync(path.join(__dirname,'chat-tools-test-'));
 const prefs={...defaults},calls=[],modes=[];
 const save=()=>fs.writeFileSync(path.join(dataFolder,'preferences.json'),JSON.stringify(prefs));
 let failure=false;
 const timeline={async tick(options){calls.push(options);if(failure)throw Error('PRIVATE');return {phase:options.enabled?'connected':'paused',windows:2,installed:1,failed:0,private:'SECRET'};}};
 const annotations=createAnnotations({dataFolder,session:'fixture',scan:async mode=>{modes.push(mode);return {windows:[{runtime:{installed:true}}]};}});
 const monitor=createMonitor({dataFolder,session:'fixture',timeline,annotations});
 save();let status=await monitor.tick();assert.equal(status.timeline.installed,1);assert.equal(status.annotations.installed,1);assert.equal(modes.at(-1),'watch');
 prefs.timelineEnabled=false;prefs.side='right';prefs.timelineGeneration++;save();
 await monitor.tick();assert.equal(calls.at(-1).enabled,false);assert.equal(calls.at(-1).side,'right');assert.equal(modes.at(-1),'watch');
 prefs.enabled=false;prefs.removeGeneration++;prefs.timelineRemoveGeneration++;save();
 await monitor.tick();assert.equal(modes.at(-1),'remove');assert.equal(calls.at(-1).removeGeneration,1);
 prefs.enabled=true;prefs.generation++;save();failure=true;status=await monitor.tick();
 assert.equal(status.timeline.phase,'adapter-error');assert.equal(status.annotations.phase,'connected');assert.equal(modes.at(-1),'install');
 assert.ok(!/PRIVATE|SECRET|private/.test(fs.readFileSync(path.join(dataFolder,'combined-status.json'),'utf8')));
 fs.writeFileSync(path.join(dataFolder,'preferences.json'),'{');await monitor.tick();assert.equal(calls.at(-1).enabled,false,'Keep last valid preferences');
 prefs.stopSession='fixture';save();const count=calls.length;assert.deepEqual(await monitor.tick(),{stopped:true});assert.equal(calls.length,count);
 let installs=0;
 const upgraded=createTimeline({requireAnnotationNavigation:true,list:async()=>[{id:'fixture',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://127.0.0.1:39223/devtools/page/fixture'}],
  snapshot:async()=>({summary:{installed:true,toolVersion:installs ? require('../app/timeline-compatibility.json').toolVersion : '0.1.3',hasAnnotationNavigation:installs>0}}),
  inspect:async()=>({loadedState:{userMessages:1},internalMethods:{scrollToKey:true}}),
  install:async()=>{installs++;return {installed:true};},remove:async()=>{},log:()=>{}});
 await upgraded.tick();await upgraded.tick();assert.equal(installs,1,'Upgrade old 0.1.3 runtime once to supply history navigation');
 const dead=spawnSync(process.execPath,['app/chat-tools-monitor.cjs','--parent=2147483647','--session='+'a'.repeat(32)],{timeout:5000});assert.equal(dead.status,0);
 console.log('PASS: one monitor, independent switches/reload/remove, independent failure handling, valid snapshots, metadata-only status, session/dead-parent exit, old Timeline capability upgrade');
})().catch(error=>{console.error(error);process.exitCode=1;});
