'use strict';
// Read-only CDP diagnostics. No clicks, scrolling, DOM changes, or chat-content export.
const fs = require('node:fs');
const {dataPath} = require('./timeline-paths.cjs');

function inspectConversation(root) {
  function visible(element) {
    if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth;
  }
  if (!root) {
    const containers = [...document.querySelectorAll('.thread-scroll-container')].filter(visible);
    root = containers.length === 1 ? containers[0] : document;
  }
  const elements = selector => [...root.querySelectorAll(selector)].filter(element =>
    root !== document || visible(element.closest('.thread-scroll-container') || element));
  const count = selector => elements(selector).length;
  const report = {
    dom: {
      turnContainers: count('[data-turn-key]'),
      userMessages: count('[data-conversation-role="user"]'),
      userBubbles: count('[data-user-message-bubble]'),
      assistantMessages: count('[data-conversation-role="assistant"]'),
      navigationItems: count('[data-thread-user-message-navigation-item-id]'),
    },
    loadedState: null,
    internalMethods: { scrollToKey: false, scrollToMessage: false, scrollToTurn: false },
    scope: 'Rendered DOM and already loaded React state only; unloaded history is not counted.',
  };
  const fibers = new Set();
  const seeds = elements('[data-turn-key], .thread-scroll-container, [data-conversation-role]').slice(0, 80);
  for (const element of seeds) {
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? element[key] : null;
    for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) fibers.add(fiber);
  }
  const visited = new Set();
  const knownMethods = Object.keys(report.internalMethods);
  function inspectObject(value, depth = 0) {
    if (!value || typeof value !== 'object' || visited.has(value) || depth > 2) return;
    visited.add(value);
    for (const name of knownMethods) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor && typeof descriptor.value === 'function') report.internalMethods[name] = true;
    }
    const current = Object.getOwnPropertyDescriptor(value, 'current');
    if (current && 'value' in current) inspectObject(current.value, depth + 1);
  }
  for (const fiber of fibers) {
    const props = fiber.memoizedProps;
    const entries = props && Object.getOwnPropertyDescriptor(props, 'entries')?.value;
    if (Array.isArray(entries) && entries.length <= 200000) {
      let turns = 0, users = 0, assistants = 0;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || !Array.isArray(entry.turn?.items)) continue;
        turns++;
        for (const item of entry.turn.items) {
          if (item?.type === 'user-message') users++;
          if (item?.type === 'assistant-message') assistants++;
        }
      }
      if (turns && (!report.loadedState || turns > report.loadedState.turns)) {
        report.loadedState = { turns, userMessages: users, assistantMessages: assistants };
      }
    }
    inspectObject(props);
    let hook = fiber.memoizedState;
    const seenHooks = new Set();
    for (let index = 0; hook && typeof hook === 'object' && index < 256 && !seenHooks.has(hook); index++) {
      seenHooks.add(hook);
      inspectObject(hook.memoizedState);
      hook = hook.next;
    }
  }
  return report;
}

async function evaluateTarget(target, port, expression, timeoutMs = 8000) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== port) {
    throw new Error('Rejected non-local or unexpected WebSocket endpoint.');
  }
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connection timed out.')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed.')); }, { once: true });
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Renderer evaluation timed out.')), timeoutMs);
      socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) return reject(new Error('The renderer rejected inspection.'));
        const value = message.result?.result?.value;
        if (!value || typeof value !== 'object') return reject(new Error('Unexpected inspection result.'));
        resolve(value);
      });
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('The renderer connection closed.')); }, { once: true });
      socket.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
  } finally { socket.close(); }
}

async function inspectTarget(target, port) {
  return evaluateTarget(target, port, '(' + inspectConversation.toString() + ')()');
}

async function main() {
  const rawPort = process.argv[2] || '39223';
  if (!/^\d+$/.test(rawPort)) throw new Error('Port must be a number.');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
  if (typeof WebSocket !== 'function') throw new Error('Node.js 22+ with built-in WebSocket is required.');
  let response;
  try { response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(4000), redirect: 'error' }); }
  catch { throw new Error('Debug endpoint unavailable. Fully quit the client, then use the Timeline launcher.'); }
  if (!response.ok) throw new Error('The endpoint did not return a page list.');
  const pages = await response.json();
  if (!Array.isArray(pages)) throw new Error('Invalid debug page list.');
  const targets = pages.filter(target => {
    if (target.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') return false;
    try {
      const url = new URL(target.url);
      return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' && !/overlay/i.test(url.search + url.hash);
    } catch { return false; }
  });
  if (!targets.length) throw new Error('No supported desktop main window was found.');
  const windows = [];
  for (let index = 0; index < targets.length; index++) {
    windows.push({ window: index + 1, ...await inspectTarget(targets[index], port) });
  }
  const result = { checkedAt: new Date().toISOString(), port, connected: true, windows,
    validation: { metadataRead: true, fullHistory: 'unverified', messageJump: 'unverified' } };
  const file = dataPath('probe-result.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8' });
  const historyFile = dataPath('probe-history.jsonl');
  fs.appendFileSync(historyFile, JSON.stringify(result) + '\n', { encoding: 'utf8' });
  console.log(JSON.stringify(result, null, 2));
  console.log('\nSaved: ' + file);
  console.log('Inspection history appended: ' + historyFile);
  console.log('Only counts and capability flags were saved. History completeness and actual jumps still require a separate test.');
}
if (require.main === module) main().catch(error => { console.error('Probe failed: ' + error.message); process.exitCode = 1; });
module.exports = { inspectConversation, inspectTarget, evaluateTarget };
