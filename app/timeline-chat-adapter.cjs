'use strict';

// Reads only the visible ChatGPT conversation; never serializes its text or IDs.
function readChatTimelineState(atom) {
  const roots = [...document.querySelectorAll('.thread-scroll-container')].filter(container => {
    if (!container.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const r = container.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  });
  if (roots.length !== 1) return null;
  const root = roots[0], fibers = new Set();
  for (const element of [...root.querySelectorAll('[data-turn-key]')].slice(0, 80)) {
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? element[key] : null;
    for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) fibers.add(fiber);
  }
  const candidates = [], apis = new Set(), sources = new Set(), scopes = new Set(), seen = new Set();
  const value = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.value;
  function visit(object, depth = 0) {
    if (!object || typeof object !== 'object' || depth > 4 || seen.has(object) || seen.size >= 40000) return;
    seen.add(object);
    if (typeof value(object, 'scrollToKey') === 'function' && typeof value(object, 'getEntryGeometry') === 'function') apis.add(object);
    if (value(object, 'domain') === 'conversation' && typeof value(object, 'contextId') === 'string' && value(object, 'contextId').startsWith('chatgpt:') &&
        typeof value(object, 'search') === 'function' && /await\s+\w+\?\.\(/.test(value(object, 'search').toString()) && value(object, 'search').toString().includes('throwIfAborted')) sources.add(object);
    if (typeof object.get === 'function' && typeof object.set === 'function' && object.queryClient && object.query) scopes.add(object);
    if (Array.isArray(object)) for (const item of object.slice(0, 500)) visit(item, depth + 1);
    else for (const key of ['current', 'value', 'memoizedState', 'memoCache', 'data', 'scope', 'searchSource', 'source', 'sources']) visit(value(object, key), depth + 1);
  }
  for (const fiber of fibers) {
    const entries = fiber.memoizedProps && value(fiber.memoizedProps, 'entries');
    if (Array.isArray(entries) && entries.length < 200000) {
      const userEntries = entries.filter(entry => typeof entry?.turnKey === 'string' && entry.turn?.items?.some(item => item.type === 'user-message'));
      if (userEntries.length) candidates.push(userEntries);
    }
    visit(fiber.memoizedProps);
    let hook = fiber.memoizedState;
    const hooks = new Set();
    for (let count = 0; hook && typeof hook === 'object' && count < 256 && !hooks.has(hook); count++, hook = hook.next) {
      hooks.add(hook); visit(hook.memoizedState);
    }
    visit(fiber.updateQueue?.memoCache?.data);
  }
  if (sources.size !== 1) return null;
  const source = [...sources][0], id = source.contextId.slice('chatgpt:'.length);
  candidates.sort((a, b) => b.length - a.length);
  let entries, api;
  for (const candidate of candidates) {
    api = [...apis].find(value => {
      try { return value.getEntryGeometry(candidate[0].turnKey) != null && value.getEntryGeometry(candidate.at(-1).turnKey) != null; }
      catch { return false; }
    });
    if (api) { entries = candidate; break; }
  }
  if (!api || !entries) return null;
  const states = [];
  for (const scope of atom ? scopes : []) {
    try { const state = scope.get(atom, id); if (typeof state?.complete === 'boolean') states.push(state); }
    catch { /* Ignore unrelated scopes. */ }
  }
  const complete = states.length > 0 && states.every(state => state.complete);
  function assistantPreview(items) {
    return items.filter(item => item.type === 'assistant-message' && typeof item.content === 'string')
      .map(item => item.content.slice(0, 5000)).join('\n\n').slice(0, 5000)
      .replace(/[^]*/g, '')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  return {
    root, contextId: source.contextId, api, complete, historyStateAvailable: states.length > 0,
    entries: entries.map(entry => ({ key: entry.turnKey, text: entry.turn.items.filter(item => item.type === 'user-message')
      .map(item => typeof item.message === 'string' ? item.message : '').join('\n').trim(), answer: assistantPreview(entry.turn.items) })),
    loadHistory: states.length && !states.some(state => state.isLoading) ? signal => source.search({ domain: 'conversation', contextId: source.contextId, query: '' }, { signal }) : null,
  };
}

async function installInChatGPT(installUI, readChat, options = {}, resolveNative) {
  const build = options.compatibility || {entryScript:'app://-/assets/index-261894768656.js',historyModule:'app://-/assets/app-initial-1da99842592d.js',historyExport:'qDn',mathModule:'app://-/assets/katex-fb2359bfd034.js'};
  const resolved = await resolveNative(readChat, build);
  const {atom, renderMath, diagnostics} = resolved;
  window.__questionTimelineDiagnostics = diagnostics;
  const persist = () => {
    try { localStorage.setItem('question-timeline:diagnostics:v1', JSON.stringify(diagnostics)); } catch { /* In-memory diagnostics remain exportable. */ }
  };
  persist();
  if (!resolved.state) return {installed: false, reason: 'conversation-adapter-unavailable', diagnostics};
  const onDiagnostic = (stage, code, error) => {
    const events = diagnostics.events, last = events.at(-1);
    if (last?.stage === stage && last.code === code && Date.now() - Date.parse(last.at) < 10000) return;
    events.push({at: new Date().toISOString(), stage, code,
      ...(error ? {errorType: ['TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'AbortError', 'TimeoutError'].includes(error.name) ? error.name : 'Error'} : {})});
    if (events.length > 80) events.splice(0, events.length - 80);
    persist();
  };
  try {
    const summary = installUI(() => {
      try { return readChat(atom); } catch (error) { onDiagnostic('adapter', 'adapter-read-failed', error); return null; }
    }, {...options, renderMath, onDiagnostic});
    onDiagnostic('ui', 'timeline-installed');
    return {...summary, diagnostics};
  } catch (error) {
    onDiagnostic('ui', 'ui-install-failed', error);
    window.__questionTimelinePrototype?.destroy();
    return {installed: false, reason: 'ui-install-failed', diagnostics};
  }
}
module.exports = { readChatTimelineState, installInChatGPT };
