'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const folder=fs.mkdtempSync(path.join(__dirname,'chat-tools-test-recovery-')),preload=path.join(folder,'preload.cjs'),data=path.join(folder,'data'),session='d'.repeat(32);
 const source=path.resolve(__dirname,'../app');
 fs.writeFileSync(preload,`const fs=require('node:fs'),path=require('node:path');
 const folder=${JSON.stringify(data)},source=${JSON.stringify(source)};
 const rename=fs.renameSync;let failures=0;
 fs.renameSync=function(from,to){if(String(to).endsWith('combined-status.json')&&failures++===0){const e=Error('PRIVATE-PAYLOAD');e.code='EBUSY';throw e;}return Reflect.apply(rename,this,arguments);};
 // The CLI closes over its factory; replace its component providers before it constructs the monitor.
 require(path.join(source,'timeline-monitor.cjs')).createMonitor=()=>({async tick(){return{phase:'connected',windows:1,installed:1,failed:0};}});
 require(path.join(source,'annotations-monitor.cjs')).createMonitor=()=>({async tick(){return{phase:'connected',windows:1,installed:1,failed:0};}});
 const mkdir=fs.mkdirSync,write=fs.writeFileSync,read=fs.readFileSync;
 fs.mkdirSync=function(p,...args){return Reflect.apply(mkdir,this,[String(p).endsWith(path.sep+'data')?folder:p,...args]);};
 fs.writeFileSync=function(p,...args){return Reflect.apply(write,this,[String(p).includes(path.join(source,'data'))?path.join(folder,path.basename(p)):p,...args]);};
 fs.renameSync=(function(original){return function(from,to){return original.call(this,String(from).includes(path.join(source,'data'))?path.join(folder,path.basename(from)):from,String(to).includes(path.join(source,'data'))?path.join(folder,path.basename(to)):to);};})(fs.renameSync);
 fs.readFileSync=function(p,...args){return Reflect.apply(read,this,[String(p).includes(path.join(source,'data'))?path.join(folder,path.basename(p)):p,...args]);};
 `);
 fs.mkdirSync(data);let stderr='';const child=spawn(process.execPath,['--require',preload,path.join(source,'chat-tools-monitor.cjs'),'--parent='+process.pid,'--session='+session],{windowsHide:true});child.stderr.on('data',b=>stderr+=b);
 try{
  const deadline=Date.now()+10000;let report;
  while(Date.now()<deadline){if(child.exitCode!==null)break;try{report=JSON.parse(fs.readFileSync(path.join(data,'combined-status.json'),'utf8'));}catch{}if(report)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(child.exitCode,null,'One transient status-file sharing error must not terminate automatic loading: '+stderr);
  assert.equal(report?.timeline.phase,'connected','A subsequent monitoring round must recover');
  const logs=fs.existsSync(path.join(data,'worker-events.jsonl'))?fs.readFileSync(path.join(data,'worker-events.jsonl'),'utf8'):'';
  assert.ok(logs.includes('monitor-round-failed')&&logs.includes('EBUSY')&&logs.includes('monitor-recovered'),'Recovery events must survive future restarts');
  assert.ok(!logs.includes('PRIVATE-PAYLOAD'),'Logs must not contain raw errors');
  fs.writeFileSync(path.join(data,'preferences.json'),JSON.stringify({enabled:true,timelineEnabled:true,generation:0,timelineGeneration:0,removeGeneration:0,timelineRemoveGeneration:0,side:null,stopSession:session}));
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Session stop did not exit')),6000);child.on('exit',()=>{clearTimeout(timeout);resolve();});});assert.equal(child.exitCode,0);
  console.log('PASS: actual monitor CLI survives transient EBUSY, recovers both features and respects intentional session shutdown');
 }finally{if(child.exitCode===null)child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
