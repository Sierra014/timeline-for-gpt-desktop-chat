'use strict';
const fs = require('node:fs');
const {dataPath} = require('./timeline-paths.cjs');
const { evaluateTarget, inspectTarget } = require('./inspect-chat.cjs');
const { installQuestionTimeline } = require('./timeline-runtime.js');
const { readChatTimelineState, installInChatGPT } = require('./timeline-chat-adapter.cjs');
const compatibility = require('./timeline-compatibility.json');
const {resolveNativeTimeline} = require('./timeline-native-resolver.cjs');
const {writeDiagnostics} = require('./timeline-diagnostics.cjs');
let stage = 'arguments';

function mainTargets(pages) {
  return pages.filter(target => {
    if (target.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') return false;
    try { const url = new URL(target.url); return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' && !/overlay/i.test(url.search + url.hash); }
    catch { return false; }
  });
}

async function installOnTarget(target, port = 39223, options = {}) {
  const previous = await evaluateTarget(target, port, `(() => { let diagnostics = window.__questionTimelineDiagnostics; if (!diagnostics) { try { diagnostics = JSON.parse(localStorage.getItem('question-timeline:diagnostics:v1') || 'null'); } catch {} } return {diagnostics:diagnostics || null}; })()`);
  if (previous.diagnostics) writeDiagnostics('previous-runtime', previous);
  const config = {...options, compatibility, toolVersion: compatibility.toolVersion};
  const expression = '(' + installInChatGPT.toString() + ')(' + installQuestionTimeline.toString() + ',' + readChatTimelineState.toString() + ',' + JSON.stringify(config) + ',' + resolveNativeTimeline.toString() + ')';
  const result = {installedAt: new Date().toISOString(), ...await evaluateTarget(target, port, expression, 45000)};
  fs.writeFileSync(dataPath('timeline-result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  writeDiagnostics('installation-result', result);
  return result;
}

async function main() {
  const remove = process.argv.includes('--remove'), port = 39223;
  const sideArg = process.argv.slice(2).find(arg => arg.startsWith('--side='));
  const options = sideArg ? { side: sideArg.slice('--side='.length) } : {};
  options.compatibility = compatibility;
  if (sideArg && !['left', 'right'].includes(options.side)) throw new Error('Side must be left or right.');
  let response;
  stage = 'debug-connection';
  try { response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(4000), redirect: 'error' }); }
  catch { throw new Error('Debug endpoint unavailable. Open GPT through the Timeline launcher.'); }
  if (!response.ok) throw new Error('Debug page list is unavailable.');
  const pages = await response.json();
  if (!Array.isArray(pages)) throw new Error('Invalid debug page list.');
  const targets = mainTargets(pages);
  if (remove) {
    const reports = [];
    for (const target of targets) reports.push(await evaluateTarget(target, port, `(() => { const present = !!window.__questionTimelinePrototype; window.__questionTimelinePrototype?.destroy(); return { removed: present }; })()`));
    console.log(JSON.stringify({ removedWindows: reports.filter(report => report.removed).length }));
    return;
  }
  const eligible = [];
  stage = 'window-discovery';
  for (const [index, target] of targets.entries()) {
    let report;
    try { report = await inspectTarget(target, port); }
    catch (error) { writeDiagnostics('window-inspection-failed', {stage, window: index + 1, errorType: error.name}); continue; }
    writeDiagnostics('window-inspected', {window: index + 1, report});
    if (report.loadedState?.userMessages > 0 && report.internalMethods.scrollToKey) eligible.push(target);
  }
  if (eligible.length !== 1) throw new Error('Keep exactly one identifiable ChatGPT conversation window open; found ' + eligible.length + '.');
  stage = 'adapter-installation';
  const result = await installOnTarget(eligible[0], port, options);
  console.log(JSON.stringify(result, null, 2));
  if (result.installed) {
    console.log('Timeline installed. Hover a tick to preview; click to jump. Use the preview bookmark button to mark a turn. Close this console freely.');
    if (result.hiddenReason === 'insufficient-margin') console.log('The timeline is hidden because the chosen side has insufficient margin. Widen the chat area or choose the other side.');
    if (!result.diagnostics?.historyAvailable) console.log('History module unavailable: showing loaded turns; scroll the conversation to load more.');
    console.log('Diagnostics: data/timeline-diagnostics.jsonl. Run check-compatibility.cjs with the bundled Node runtime to export later runtime errors.');
  }
  else process.exitCode = 1;
}
if (require.main === module) main().catch(error => {
  writeDiagnostics('installation-failed', {stage, errorType: error.name});
  console.error('Timeline failed: ' + error.message); console.error('Diagnostics saved to data/timeline-diagnostics.jsonl.'); process.exitCode = 1;
});
module.exports = {mainTargets, installOnTarget};
