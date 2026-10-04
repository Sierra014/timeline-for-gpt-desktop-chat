'use strict';
const fs = require('node:fs');
const {dataPath} = require('./timeline-paths.cjs');
const {evaluateTarget, inspectTarget} = require('./inspect-chat.cjs');
const {mainTargets, installOnTarget} = require('./question-timeline.cjs');
const {writeDiagnostics} = require('./timeline-diagnostics.cjs');
const build = require('./timeline-compatibility.json');

function runtimeSnapshot() {
  return {summary: window.__questionTimelinePrototype?.summary() || null, diagnostics: window.__questionTimelineDiagnostics || null};
}

// Dependency injection keeps lifecycle tests off the user's real desktop client.
function createMonitor({list, snapshot, inspect, install, remove, log, now = Date.now, version = build.toolVersion}) {
  const states = new Map();
  let appliedRemoval = 0;
  async function tick(preferences = {}) {
    let pages;
    try { pages = mainTargets(await list()); }
    catch { states.clear(); return {phase: preferences.enabled === false ? 'paused' : 'waiting-for-debug', windows: 0, installed: 0, failed: 0}; }
    const current = new Set(pages.map(page => page.id));
    for (const id of states.keys()) if (!current.has(id)) states.delete(id);
    const removal = Number(preferences.removeGeneration) || 0;
    if (removal > appliedRemoval) {
      for (const page of pages) { try { await remove(page); } catch { log('tray-remove-failed', {stage: 'remove'}); } }
      appliedRemoval = removal; states.clear();
    }
    const enabled = preferences.enabled !== false;
    const generation = Number(preferences.generation) || 0;
    let installed = 0, failed = 0;
    for (const page of pages) {
      let previous = states.get(page.id);
      if (!previous) { previous = {generation, retryAt: 0, diagnosticSignature: '', failed: false}; states.set(page.id, previous); }
      try {
        const current = await snapshot(page);
        const diagnosticSignature = JSON.stringify(current.diagnostics || null);
        if (diagnosticSignature !== previous.diagnosticSignature) {
          if (current.diagnostics) log('tray-runtime', {diagnostics: current.diagnostics});
          previous.diagnosticSignature = diagnosticSignature;
        }
        if (!enabled) { if (current.summary?.installed) installed++; continue; }
        const requested = previous.generation !== generation;
        if (current.summary?.installed && current.summary.toolVersion === version && !requested) {
          installed++; previous.failed = false; continue;
        }
        if (!requested && now() < previous.retryAt) { if (previous.failed) failed++; continue; }
        const report = await inspect(page);
        if (!report.loadedState?.userMessages || !report.internalMethods?.scrollToKey) continue;
        previous.generation = generation;
        const options = ['left', 'right'].includes(preferences.side) ? {side: preferences.side} : {};
        const result = await install(page, options);
        previous.failed = !result.installed;
        previous.retryAt = result.installed ? 0 : now() + 30000;
        if (result.installed) installed++; else failed++;
      } catch {
        if (now() >= previous.retryAt) log('tray-window-failed', {stage: 'watch-window', errorType: 'Error'});
        previous.failed = true; previous.retryAt = now() + 30000; failed++;
      }
    }
    return {phase: enabled ? failed ? 'adapter-error' : 'connected' : 'paused', windows: pages.length, installed, failed};
  }
  return {tick};
}

async function main() {
  const parentArg = process.argv.find(arg => arg.startsWith('--parent='));
  const parent = parentArg ? Number(parentArg.slice(9)) : null;
  if (parentArg && (!Number.isInteger(parent) || parent <= 0)) throw Error('Invalid parent process.');
  const session = process.argv.find(arg => arg.startsWith('--session='))?.slice(10) || '';
  const port = 39223;
  const monitor = createMonitor({
    list: async () => {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list', {signal: AbortSignal.timeout(2000), redirect: 'error'});
      if (!response.ok) throw Error('Debug unavailable');
      const pages = await response.json(); if (!Array.isArray(pages)) throw Error('Invalid pages'); return pages;
    },
    snapshot: page => evaluateTarget(page, port, '(' + runtimeSnapshot.toString() + ')()'),
    inspect: page => inspectTarget(page, port),
    install: (page, options) => installOnTarget(page, port, options),
    remove: page => evaluateTarget(page, port, '(() => { window.__questionTimelinePrototype?.destroy(); return {removed:true}; })()'),
    log: writeDiagnostics,
  });
  let stop = false, lastPhase = '';
  process.on('SIGTERM', () => {stop = true;}); process.on('SIGINT', () => {stop = true;});
  while (!stop) {
    if (parent) { try {process.kill(parent, 0);} catch {break;} }
    let preferences = {};
    try {preferences = JSON.parse(fs.readFileSync(dataPath('tray-preferences.json'), 'utf8').replace(/^\uFEFF/, ''));} catch {}
    if (session && preferences.stopSession === session) break;
    const status = {at: new Date().toISOString(), toolVersion: build.toolVersion, ...await monitor.tick(preferences)};
    if (status.phase !== lastPhase) {writeDiagnostics('tray-state', {phase: status.phase}); lastPhase = status.phase;}
    const statusPath = dataPath('tray-status.json');
    try {
      fs.writeFileSync(statusPath + '.tmp', JSON.stringify(status), 'utf8'); fs.renameSync(statusPath + '.tmp', statusPath);
    } catch { writeDiagnostics('tray-status-write-failed', {stage:'status-file',errorType:'Error'}); }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  writeDiagnostics('tray-monitor-stopped');
}
if (require.main === module) main().catch(() => {writeDiagnostics('tray-monitor-failed', {stage: 'monitor', errorType: 'Error'}); process.exitCode = 1;});
module.exports = {createMonitor, runtimeSnapshot};
