'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pass} = require('./annotate-chat.cjs');
const defaults = {enabled:true,generation:0,removeGeneration:0,stopSession:''};
function createMonitor({scan = pass, dataFolder = path.join(__dirname,'data'), session = ''} = {}) {
  let preferences = {...defaults}, generation = 0, removed = 0, lastSignature = '', lastWriteAt = 0;
  function readPreferences() {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dataFolder,'preferences.json'),'utf8').replace(/^\uFEFF/,''));
      if (typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
          !Number.isSafeInteger(value.removeGeneration) || value.removeGeneration < 0 || typeof value.stopSession !== 'string') return preferences;
      preferences = {...defaults,...value};
    } catch { /* Keep the last complete preference snapshot during atomic replacement. */ }
    return preferences;
  }
  async function tick() {
    const prefs = readPreferences();
    if (session && prefs.stopSession === session) return {stopped:true};
    let report;
    try {
      if (!prefs.enabled && prefs.removeGeneration > removed) {
        report = await scan('remove');
        if (!report.windows.some(window => window.failed)) removed = prefs.removeGeneration;
      } else {
        report = await scan(prefs.enabled ? prefs.generation !== generation ? 'install' : 'watch' : 'check');
      }
      if (prefs.enabled) {generation = prefs.generation; removed = prefs.removeGeneration;}
      const windows = report.windows;
      const installed = windows.filter(window => window.installed || window.runtime?.installed).length;
      const failed = windows.filter(window => window.failed).length;
      const unsupported = windows.filter(window => window.supported && !window.supportsHighlights).length;
      const phase = !prefs.enabled ? 'paused' : failed || unsupported ? 'adapter-error' : installed ? 'connected' : windows.some(window => window.waitingForApplication) ? 'waiting-application' : 'waiting-conversation';
      report = {phase,version:report.version,windows:windows.length,installed,failed,unsupported};
    } catch { report = {phase:prefs.enabled ? 'waiting-debug' : 'paused',windows:0,installed:0,failed:0,endpointReady:false}; }
    const now = Date.now(), signature = JSON.stringify({workerPid:process.pid,enabled:prefs.enabled,...report});
    const status = {at:new Date(now).toISOString(),workerPid:process.pid,enabled:prefs.enabled,...report};
    const file = path.join(dataFolder,'status.json');
    if (signature !== lastSignature || now - lastWriteAt >= 20000 || !fs.existsSync(file)) {
      fs.mkdirSync(dataFolder,{recursive:true});
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary,JSON.stringify(status),'utf8');
      fs.renameSync(temporary,file);
      lastSignature = signature; lastWriteAt = now;
    }
    return status;
  }
  return {tick};
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !/^--parent=[1-9]\d*$/.test(args[0]) || !/^--session=[a-f0-9]{32}$/.test(args[1])) throw Error('Use the annotations control window to start the monitor.');
  const parent = Number(args[0].slice(9)), session = args[1].slice(10);
  const monitor = createMonitor({session});
  let stop = false;
  process.on('SIGINT',() => {stop = true;}); process.on('SIGTERM',() => {stop = true;});
  while (!stop) {
    try {process.kill(parent,0);} catch {break;}
    if ((await monitor.tick()).stopped) break;
    if (!stop) await new Promise(resolve => setTimeout(resolve,2000));
  }
}
if (require.main === module) main().catch(() => {console.error('Annotations monitor failed. Check folder write permission and restart the assistant.');process.exitCode = 1;});
module.exports = {createMonitor};
