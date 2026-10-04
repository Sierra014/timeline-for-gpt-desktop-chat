'use strict';

// Serialized into the renderer. Only module metadata and capability flags leave it.
async function resolveNativeTimeline(readChat, build) {
  const asset = value => {
    try {
      const url = new URL(value, 'app://-/assets/');
      url.search = ''; url.hash = '';
      return url.protocol === 'app:' && url.hostname === '-' && /^\/assets\/[\w.-]+\.js$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  };
  const entries = [...document.scripts].map(script => asset(script.src)).filter(src => src && /\/index-[\w-]+\.js$/.test(src));
  const diagnostics = {entryScripts: entries, referenceEntry: build.entryScript, buildMatchesReference: entries.includes(build.entryScript),
    historyAvailable: false, mathAvailable: false, historyModule: null, historyExport: null, mathModule: null, events: []};
  const record = (stage, code, error) => {
    const errorType = ['Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : error ? 'Error' : undefined;
    diagnostics.events.push({at: new Date().toISOString(), stage, code, ...(errorType ? {errorType} : {})});
    if (diagnostics.events.length > 80) diagnostics.events.splice(0, diagnostics.events.length - 80);
  };
  if (!diagnostics.buildMatchesReference) record('build', 'changed-build-attempted');
  let state;
  try { state = readChat(); } catch (error) { record('adapter', 'adapter-read-failed', error); }
  if (!state?.entries?.length || !state.api) {
    record('adapter', 'conversation-adapter-unavailable');
    return {state: null, diagnostics};
  }
  const paths = new Set(entries);
  for (const entry of typeof performance !== 'undefined' ? performance.getEntriesByType('resource') : []) {
    const path = asset(entry.name); if (path) paths.add(path);
  }
  const texts = new Map();
  async function source(path) {
    if (texts.has(path)) return texts.get(path);
    try {
      const response = await fetch(path, {signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('Asset unavailable');
      const text = await response.text();
      if (text.length > 80000000) throw Error('Asset too large');
      texts.set(path, text);
      // Read dependency filenames, never execute or export the fetched source text.
      for (const match of text.matchAll(/["'`]((?:\.\/|\/assets\/|app:\/\/-\/assets\/)?(?:app-initial|katex)-[\w-]+\.js)["'`]/g)) {
        const dependency = asset(new URL(match[1], path).href); if (dependency) paths.add(dependency);
      }
      return text;
    } catch (error) { record('module-discovery', 'asset-source-unavailable', error); return ''; }
  }
  let atom;
  async function history(path, exportName) {
    try {
      const module = await import(path);
      const candidate = module[exportName];
      if (!candidate) { record('history', 'history-export-unavailable'); return false; }
      const candidateState = readChat(candidate);
      if (!candidateState?.historyStateAvailable) { record('history', 'history-state-unavailable'); return false; }
      atom = candidate; state = candidateState;
      diagnostics.historyAvailable = true; diagnostics.historyModule = path; diagnostics.historyExport = exportName;
      return true;
    } catch (error) { record('history', 'history-module-unavailable', error); return false; }
  }
  const referenceHistory = asset(build.historyModule);
  const referenceMath = asset(build.mathModule);
  if (referenceHistory) await history(referenceHistory, build.historyExport);
  if (!atom || !diagnostics.buildMatchesReference) for (const entry of entries.slice(0, 3)) await source(entry);
  const historyPaths = [...paths].filter(path => /\/app-initial-[\w-]+\.js$/.test(path)).slice(0, 4);
  for (const path of historyPaths) {
    if (atom) break;
    if (path !== referenceHistory && await history(path, build.historyExport)) break;
    const text = await source(path);
    // Identify the pagination atom from its native state shape, then its public alias.
    const localAtoms = new Set([...text.matchAll(/\.set\(([\w$]+),[^,()]{1,100},\{numTurns:[^{}]{0,200}cursor:null,oldestMessageId:null,complete:/g)].map(match => match[1]));
    const exports = text.slice(text.lastIndexOf('export{'));
    for (const local of localAtoms) {
      const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const alias = exports.match(new RegExp('(?:[,{])\\s*' + escaped + '\\s+as\\s+([\\w$]+)(?=[,}])'))?.[1];
      if (alias && await history(path, alias)) break;
    }
  }
  if (!atom) record('history', 'loaded-history-only');
  let renderMath;
  async function math(path) {
    try {
      const katex = (await import(path)).default;
      if (typeof katex?.renderToString !== 'function') throw Error('Math renderer unavailable');
      renderMath = (tex, displayMode) => katex.renderToString(tex, {
        output: 'mathml', displayMode, throwOnError: true, strict: 'ignore', trust: false, maxSize: 8, maxExpand: 1000,
      });
      diagnostics.mathAvailable = true; diagnostics.mathModule = path; return true;
    } catch (error) { record('math', 'math-module-unavailable', error); return false; }
  }
  if (referenceMath) await math(referenceMath);
  if (!renderMath && !historyPaths.some(path => texts.has(path))) for (const path of historyPaths.slice(0, 1)) await source(path);
  if (!renderMath) for (const path of [...paths].filter(path => /\/katex-[\w-]+\.js$/.test(path)).slice(0, 4)) {
    if (path !== referenceMath && await math(path)) break;
  }
  if (!renderMath) record('math', 'math-source-fallback');
  record('adapter', 'adapter-found');
  return {atom, state, renderMath, diagnostics};
}
module.exports = {resolveNativeTimeline};
