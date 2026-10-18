'use strict';
const fs = require('node:fs');
const path = require('node:path');
const version = '0.1.11';
function component(name) {
  return require(path.join(__dirname, name));
}
function nativeTimeline() {
  const {createMonitor, runtimeSnapshot} = component('timeline-monitor.cjs');
  const {evaluateTarget, inspectTarget} = component('inspect-chat.cjs');
  const {installOnTarget} = component('question-timeline.cjs');
  const {writeDiagnostics} = component('timeline-diagnostics.cjs');
  const {listTargets} = component('desktop-connection.cjs');
  return createMonitor({
    list:listTargets,
    snapshot:page => evaluateTarget(page,39223,'(' + runtimeSnapshot.toString() + ')()'),
    inspect:page => inspectTarget(page,39223),
    install:(page,options) => installOnTarget(page,39223,options),
    remove:page => evaluateTarget(page,39223,'(() => {window.__questionTimelinePrototype?.destroy();if(!window.__chatAnnotationsV1)window.__chatAnnotationLifecycleV1?.destroy();return {removed:true};})()'),
    log:writeDiagnostics, requireAnnotationNavigation:true,
  });
}
const defaults = {enabled:true,timelineEnabled:true,generation:0,timelineGeneration:0,
  removeGeneration:0,timelineRemoveGeneration:0,side:null,stopSession:''};
function createMonitor({dataFolder=path.join(__dirname,'data'),session='',timeline,annotations}={}) {
  timeline ||= nativeTimeline();
  annotations ||= component('annotations-monitor.cjs').createMonitor({dataFolder,session});
  let preferences = {...defaults};
  function readPreferences() {
    try {
      const value=JSON.parse(fs.readFileSync(path.join(dataFolder,'preferences.json'),'utf8').replace(/^\uFEFF/,''));
      if (typeof value.enabled!=='boolean' || typeof value.timelineEnabled!=='boolean' ||
          typeof value.stopSession!=='string' || !['generation','timelineGeneration','removeGeneration','timelineRemoveGeneration']
          .every(key=>Number.isSafeInteger(value[key]) && value[key]>=0) || ![null,'left','right'].includes(value.side)) return preferences;
      preferences={...defaults,...value};
    } catch { /* Keep the last valid atomic snapshot. */ }
    return preferences;
  }
  async function tick() {
    const prefs=readPreferences();
    if (session && prefs.stopSession===session) return {stopped:true};
    // Separate renderer operations let one adapter continue while the other is unavailable.
    const results=await Promise.allSettled([
      timeline.tick({enabled:prefs.timelineEnabled,generation:prefs.timelineGeneration,
        removeGeneration:prefs.timelineRemoveGeneration,side:prefs.side}),
      annotations.tick(),
    ]);
    const fallback={phase:'adapter-error',windows:0,installed:0,failed:1};
    const resultAt=index=>results[index].status==='fulfilled' ? results[index].value : {...fallback};
    const featureStatus=index=>{
      const result=resultAt(index);
      return {phase:result.phase,windows:result.windows,installed:result.installed,
        failed:result.failed,unsupported:result.unsupported || 0};
    };
    const status={at:new Date().toISOString(),workerPid:process.pid,version,
      timeline:featureStatus(0),annotations:featureStatus(1)};
    fs.mkdirSync(dataFolder,{recursive:true});
    const file=path.join(dataFolder,'combined-status.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify(status),'utf8');fs.renameSync(file+'.tmp',file);
    return status;
  }
  return {tick};
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || !/^--parent=[1-9]\d*$/.test(args[0]) || !/^--session=[a-f0-9]{32}$/.test(args[1]))
    throw Error('Start the combined control window.');
  const parent=Number(args[0].slice(9)),session=args[1].slice(10);
  const monitor=createMonitor({session});
  let stop=false;
  process.on('SIGINT',()=>{stop=true;});process.on('SIGTERM',()=>{stop=true;});
  function record(event,error) {
    try {
      const folder=path.join(__dirname,'data'),file=path.join(folder,'worker-events.jsonl');fs.mkdirSync(folder,{recursive:true});
      if(fs.existsSync(file)&&fs.statSync(file).size>262144)fs.renameSync(file,file+'.1');
      const errorType=['Error','TypeError','RangeError','SyntaxError'].includes(error?.name)?error.name:'Error';
      const code=['EBUSY','EPERM','EACCES','ENOENT','ENOSPC','EIO','ESRCH'].includes(error?.code)?error.code:undefined;
      fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,workerPid:process.pid,...error?{errorType,code}:{}})+'\n','utf8');
    }catch { /* Logging must never stop monitoring. */ }
  }
  record('worker-start');let failed=false;
  while(!stop) {
    try {process.kill(parent,0);} catch(error) {if(error.code==='ESRCH'){record('parent-exited');break;}}
    try {
      if((await monitor.tick()).stopped){record('session-stop');break;}
      if(failed){record('monitor-recovered');failed=false;}
    }catch(error) {if(!failed)record('monitor-round-failed',error);failed=true;}
    if(!stop) await new Promise(resolve=>setTimeout(resolve,2000));
  }
  record('worker-stop');
}
if(require.main===module) main().catch(()=>{console.error('Chat Tools monitor failed. Check folder write permissions and restart.');process.exitCode=1;});
module.exports={createMonitor,defaults,version};
