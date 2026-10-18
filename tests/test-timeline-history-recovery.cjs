'use strict';
const assert=require('node:assert/strict');
const {createMonitor}=require('../app/timeline-monitor.cjs');
const version=require('../app/timeline-compatibility.json').toolVersion;
(async()=>{
 let clock=1000,attempts=0,ready=false,runtime={};
 const page={id:'fixture',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://127.0.0.1:39223/devtools/page/fixture'};
 const monitor=createMonitor({requireAnnotationNavigation:true,now:()=>clock,list:async()=>[page],snapshot:async()=>runtime,
  inspect:async()=>({loadedState:{userMessages:5},internalMethods:{scrollToKey:true}}),
  install:async()=>{attempts++;runtime={summary:{installed:true,toolVersion:version,hasAnnotationNavigation:true,questionCount:ready?50:5,complete:ready},diagnostics:{historyAvailable:ready}};return{...runtime.summary,diagnostics:runtime.diagnostics};},remove:async()=>{},log:()=>{}});
 assert.equal((await monitor.tick()).phase,'waiting-history');assert.equal(attempts,1);assert.equal(runtime.summary.questionCount,5);
 clock+=2000;await monitor.tick();assert.equal(attempts,1,'No retry every watcher tick');
 ready=true;clock+=31000;assert.equal((await monitor.tick()).phase,'connected');assert.equal(attempts,2,'A loaded-only timeline must retry history resolution after a cold resource timeout');
 assert.equal(runtime.summary.questionCount,50,'Native history recovery expands beyond the initial five turns');
 clock+=31000;await monitor.tick();assert.equal(attempts,2,'Healthy complete timelines are not repeatedly reinstalled');
 // Paused helpers must never recover/install by themselves.
 runtime.diagnostics.historyAvailable=false;runtime.summary.complete=false;clock+=31000;await monitor.tick({enabled:false});assert.equal(attempts,2);
 console.log('PASS: cold resource failure recovers beyond five turns, retry backoff, complete runtime stability, pause respected');
})().catch(error=>{console.error(error);process.exitCode=1;});
