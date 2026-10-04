'use strict';
const fs = require('node:fs');
const {dataPath} = require('./timeline-paths.cjs');
const {evaluateTarget} = require('./inspect-chat.cjs');
const {readChatTimelineState} = require('./timeline-chat-adapter.cjs');
const compatibility = require('./timeline-compatibility.json');
const {resolveNativeTimeline} = require('./timeline-native-resolver.cjs');
const {writeDiagnostics} = require('./timeline-diagnostics.cjs');

// No UI installation, history loading, scrolling, messages, or content export.
async function inspectCompatibility(readChat, build, resolveNative) {
  let runtimeDiagnostics = window.__questionTimelineDiagnostics || null;
  if (!runtimeDiagnostics) { try { runtimeDiagnostics = JSON.parse(localStorage.getItem('question-timeline:diagnostics:v1') || 'null'); } catch {} }
  const {state, diagnostics} = await resolveNative(readChat, build);
  const coreCompatible = !!(state?.entries?.length && state.api);
  return {status: coreCompatible ? 'adapter-found' : 'conversation-adapter-unavailable', coreCompatible,
    ...(coreCompatible ? {questionCount:state.entries.length,complete:state.complete===true} : {}),
    mathAvailable: diagnostics.mathAvailable, historyAvailable: diagnostics.historyAvailable, diagnostics, runtimeDiagnostics};
}

async function main() {
  const port = 39223;
  let response;
  try { response = await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(4000),redirect:'error'}); }
  catch { throw Error('Debug endpoint unavailable. Open GPT through the Timeline launcher.'); }
  if (!response.ok) throw Error('Debug page list unavailable.');
  const pages = await response.json();
  if (!Array.isArray(pages)) throw Error('Invalid debug page list.');
  const windows = [];
  for (const page of pages) {
    try {const url=new URL(page.url);if(page.type!=='page'||url.protocol!=='app:'||url.hostname!=='-'||url.pathname!=='/index.html'||/overlay/i.test(url.search+url.hash))continue;}catch{continue;}
    let report;
    try { report = await evaluateTarget(page,port,'('+inspectCompatibility.toString()+')('+readChatTimelineState.toString()+','+JSON.stringify(compatibility)+','+resolveNativeTimeline.toString()+')',45000); }
    catch (error) {report = {status:'inspection-failed',coreCompatible:false,errorType:error.name};}
    windows.push({window:windows.length+1,...report});
  }
  const result = {checkedAt:new Date().toISOString(),toolVersion:compatibility.toolVersion,connected:true,readOnly:true,windows,
    supportedWindows:windows.filter(window=>window.coreCompatible).length};
  fs.writeFileSync(dataPath('compatibility-result.json'),JSON.stringify(result,null,2)+'\n','utf8');
  writeDiagnostics('compatibility-result', result);
  console.log(JSON.stringify(result,null,2));
  console.log('Check only: no timeline installed and no messages sent.');
  if (!result.supportedWindows) {console.log('No usable visible ChatGPT adapter found. See data/timeline-diagnostics.jsonl for attempted capabilities.');process.exitCode=2;}
  else console.log('Adapter found. Build changes are advisory; installation is allowed when capabilities work.');
}
if(require.main===module)main().catch(error=>{writeDiagnostics('compatibility-check-failed',{stage:'debug-connection',errorType:error.name});console.error('Compatibility check failed: '+error.message);process.exitCode=1;});
module.exports={inspectCompatibility};
