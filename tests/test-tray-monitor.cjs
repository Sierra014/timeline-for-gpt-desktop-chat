'use strict';
const assert = require('node:assert/strict');
const {createMonitor} = require('../app/timeline-monitor.cjs');
const build = require('../app/timeline-compatibility.json');

function fixture() {
  const page = id => ({id, type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:39223/devtools/page/' + id});
  let pages = [page('PRIVATE-chat-window'), page('PRIVATE-code-window'), {...page('overlay'), url: 'app://-/index.html?overlay'}, {...page('web'), url: 'https://example.test/'}];
  let time = 0, disconnected = false, failure = false;
  const summaries = new Map(), logs = [], calls = [];
  const monitor = createMonitor({
    list: async () => {if (disconnected) throw Error('PRIVATE-ERROR'); return pages;},
    snapshot: async page => ({summary: summaries.get(page.id) || null, diagnostics: summaries.has(page.id) ? {events: [{at:'fixed',stage:'jump',code:'jump-failed'}]} : null}),
    inspect: async page => ({loadedState: {userMessages: page.id.includes('chat') ? 20 : 0}, internalMethods: {scrollToKey: page.id.includes('chat')}}),
    install: async (page, options) => {
      calls.push({type:'install', id:page.id, ...options});
      if (failure) return {installed:false};
      summaries.set(page.id, {installed:true, toolVersion:build.toolVersion, questionCount:20, side:options.side || 'left'});
      return {installed:true};
    },
    remove: async page => {calls.push({type:'remove',id:page.id}); summaries.delete(page.id);},
    log: (event, metadata) => logs.push({event,...metadata}), now: () => time,
  });
  return {monitor, summaries, logs, calls, setTime:v=>{time=v;}, setPages:v=>{pages=v;}, page,
    disconnect:v=>{disconnected=v;}, fail:v=>{failure=v;}};
}

(async () => {
  const f = fixture();
  assert.equal((await f.monitor.tick()).installed,1);
  assert.equal(f.calls.length,1,'Only identifiable chat windows get installed');
  assert.equal((await f.monitor.tick()).windows,2,'Overlays and external pages are excluded');
  assert.equal(f.calls.length,1,'An installed timeline must not be reinstalled on each poll or conversation switch');
  assert.equal(f.logs.filter(log=>log.event==='tray-runtime').length,1,'Unchanged runtime diagnostics are not repeatedly written');
  f.summaries.delete('PRIVATE-chat-window');
  assert.equal((await f.monitor.tick()).installed,1);
  assert.equal(f.calls.length,2,'A refreshed renderer gets reinstalled without a 30-second delay');
  await f.monitor.tick({generation:1,side:'right'});
  assert.equal(f.calls.at(-1).side,'right','A side/reload request forces one reinstall');
  assert.equal(f.calls.length,3);
  await f.monitor.tick({generation:1,side:'right'}); assert.equal(f.calls.length,3);
  f.summaries.delete('PRIVATE-chat-window');
  assert.equal((await f.monitor.tick({enabled:false,generation:1})).phase,'paused');
  assert.equal(f.calls.length,3,'Paused automation does not reinstall');
  await f.monitor.tick({enabled:true,generation:1}); assert.equal(f.calls.length,4);
  const removed=await f.monitor.tick({enabled:false,generation:1,removeGeneration:1});
  assert.equal(removed.installed,0); assert.equal(f.calls.filter(call=>call.type==='remove').length,2);
  await f.monitor.tick({enabled:false,generation:1,removeGeneration:1});
  assert.equal(f.calls.filter(call=>call.type==='remove').length,2,'A removal request is applied only once');
  f.disconnect(true);
  assert.equal((await f.monitor.tick()).phase,'waiting-for-debug');
  f.disconnect(false); await f.monitor.tick(); assert.equal(f.calls.filter(call=>call.type==='install').length,5);
  f.setPages([f.page('PRIVATE-chat-new')]); await f.monitor.tick();
  assert.equal(f.calls.at(-1).id,'PRIVATE-chat-new','New windows get independent installations');
  f.summaries.set('PRIVATE-chat-new',{installed:true,toolVersion:'old'}); await f.monitor.tick();
  assert.equal(f.summaries.get('PRIVATE-chat-new').toolVersion,build.toolVersion,'Old timeline instances get upgraded');
  assert.equal(JSON.stringify(f.logs).includes('PRIVATE-'),false,'Logs exclude page identities and raw errors');
  const failed=fixture(); failed.fail(true);
  assert.equal((await failed.monitor.tick()).failed,1); await failed.monitor.tick(); assert.equal(failed.calls.length,1);
  failed.setTime(30001); await failed.monitor.tick(); assert.equal(failed.calls.length,2,'Failed adapters retry with backoff');
  failed.fail(false); await failed.monitor.tick({generation:1}); assert.equal(failed.calls.length,3,'Explicit reload bypasses failure backoff');
  console.log('PASS: auto-install, no duplicate installs, refreshed/new windows, upgrades, side/reload commands, pause/remove, reconnect, failure backoff and content-free runtime log persistence.');
})().catch(error=>{console.error(error);process.exitCode=1;});
