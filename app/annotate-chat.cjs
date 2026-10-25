'use strict';
const {listTargets, evaluate} = require('./desktop-connection.cjs');
const {readAnnotationSurface} = require('./annotations-adapter.js');
const {installChatAnnotations} = require('./annotations-runtime.js');
const {installAnnotationStore} = require('./annotations-store.js');
const {installAnnotationLifecycle} = require('./annotations-lifecycle.js');
const version = '0.1.24';

function removeAnnotations(keepLifecycle = false) {
  const selector = '#chat-annotations-v1,style[data-chat-annotations-style="v1"]';
  const removed = !!window.__chatAnnotationsV1 || !!document.querySelector(selector);
  window.__chatAnnotationsV1?.destroy();
  if(!keepLifecycle&&!window.__questionTimelinePrototype)window.__chatAnnotationLifecycleV1?.destroy();
  for (const element of document.querySelectorAll(selector)) element.remove();
  for (const color of ['yellow','green','pink']) CSS.highlights?.delete('chat-annotations-' + color);
  return {removed};
}

// A debug target/document can be available long before the native React shell boots.
// Only committed, visible application UI permits native module discovery and hooks.
function applicationReady() {
  if (document.readyState !== 'complete') return false;
  return [...document.querySelectorAll('.thread-scroll-container,nav,aside')].some(element => {
    if (!element.checkVisibility({visibilityProperty:true,opacityProperty:true})) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 &&
      (element.matches('.thread-scroll-container') || !!element.querySelector('button,a[href]'));
  });
}
function inspect(readSurface, readReady) {
  const surface = readSurface();
  const runtime = window.__chatAnnotationsV1?.summary() || null;
  let uiTheme = runtime?.uiTheme || window.__questionTimelinePrototype?.summary?.()?.uiTheme || null;
  if (!uiTheme && typeof document !== 'undefined' && document.documentElement) {
    const rawLang = document.documentElement.lang || (typeof navigator !== 'undefined' && navigator.language) || 'zh';
    const lang = /^zh\b/i.test(rawLang) ? 'zh' : 'en';
    const docStyle = getComputedStyle(document.documentElement);
    const parseRgb = v => {
      const s = String(v || '').trim();
      if (/^#[\da-f]{3}$/i.test(s)) return [1, 2, 3].map(i => parseInt(s[i] + s[i], 16));
      if (/^#[\da-f]{6}$/i.test(s)) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
      const m = s.match(/^rgba?\(([^)]+)\)$/i);
      if (!m) return null;
      const p = m[1].trim().split(/[\s,/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.slice(0, 3).some(n => !Number.isFinite(n))) return null;
      if (p.length >= 4 && Number.isFinite(p[3]) && p[3] < 0.5) return null;
      return p.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(n))));
    };
    const toHex = rgb => '#' + rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
    const mix = (a, b, w) => [0, 1, 2].map(i => Math.round(a[i] * (1 - w) + b[i] * w));
    const pick = keys => { for (const k of keys) { const c = parseRgb(docStyle.getPropertyValue(k)); if (c) return c; } return null; };
    const sRgb = pick(['--codex-base-surface', '--app-color-background-surface', '--color-surface']) || (document.body ? parseRgb(getComputedStyle(document.body).backgroundColor) : null) || [255, 253, 253];
    const uRgb = pick(['--app-color-background-surface-under']) || (document.body ? parseRgb(getComputedStyle(document.body).backgroundColor) : null) || sRgb;
    const iRgb = pick(['--codex-base-ink', '--app-color-text-foreground', '--color-text']) || (document.body ? parseRgb(getComputedStyle(document.body).color) : null) || [41, 38, 43];
    const aRgb = pick(['--codex-base-accent', '--app-color-border-focus', '--app-color-text-accent', '--color-ring']) || [232, 62, 118];
    const dark = (sRgb[0] + sRgb[1] + sRgb[2]) / 3 < 128;
    uiTheme = { lang, dark, bg: toHex(uRgb), surface: toHex(sRgb), ink: toHex(iRgb), muted: toHex(mix(iRgb, sRgb, 0.48)), border: toHex(mix(iRgb, sRgb, dark ? 0.78 : 0.85)), accent: toHex(aRgb) };
  }
  return {applicationReady:readReady(), supported:!!surface, supportsHighlights:!!CSS.highlights && typeof Highlight === 'function',
    annotationHosts:document.querySelectorAll('#chat-annotations-v1').length,
    messages:surface?.messages.length || 0, uniqueMessages:surface ? new Set(surface.messages.map(message => message.messageId)).size : 0,
    mode:surface?.contextId.startsWith('codex:') ? 'codex' : surface ? 'chatgpt' : 'unrecognized',
    runtime, uiTheme,
    lifecycle:window.__chatAnnotationLifecycleV1?.summary() || null};
}
async function pass(mode) {
  const windows = [];
  for (const [index, target] of (await listTargets()).entries()) {
    try {
      if (mode === 'remove') {
        const result = await evaluate(target, '(' + removeAnnotations.toString() + ')()');
        windows.push({window:index + 1, ...result}); continue;
      }
      const report = await evaluate(target, '(' + inspect.toString() + ')(' + readAnnotationSurface.toString() + ',' + applicationReady.toString() + ')');
      if (mode !== 'check') {
        if (!report.applicationReady) {
          if (report.annotationHosts) await evaluate(target,'('+removeAnnotations.toString()+')(true)');
          windows.push({window:index + 1, ...report, removed:!!report.annotationHosts, waitingForConversation:!report.supported, waitingForApplication:true}); continue;
        }
        // Recheck inside the installer: navigation can replace the page between evaluations.
        const refreshOnly = mode === 'watch' && report.lifecycle?.installed && report.lifecycle.version === 3;
        report.lifecycle = await evaluate(target, refreshOnly
          ? '(() => { if (!(' + applicationReady.toString() + ')()) return {installed:false,waitingForApplication:true}; const lc = window.__chatAnnotationLifecycleV1; if (lc?.version === 3) { lc.refresh(); return lc.summary(); } return {installed:false}; })()'
          : '('+installAnnotationLifecycle.toString()+')('+installAnnotationStore.toString()+',{ready:'+applicationReady.toString()+'})');
        if (!report.lifecycle.installed && !report.lifecycle.waitingForApplication) {
          report.lifecycle = await evaluate(target,'('+installAnnotationLifecycle.toString()+')('+installAnnotationStore.toString()+',{ready:'+applicationReady.toString()+'})');
        }
        if (report.lifecycle.waitingForApplication) {
          windows.push({window:index + 1, ...report, waitingForApplication:true}); continue;
        }
      }
      if (mode !== 'check' && !report.supported && report.annotationHosts) {
        // Keep lifecycle observation on blank/settings pages, where sidebar deletion is still possible.
        await evaluate(target,'('+removeAnnotations.toString()+')(true)');
        windows.push({window:index + 1, mode:report.mode, removed:true, waitingForConversation:true, uiTheme:report.uiTheme}); continue;
      }
      if (mode === 'check' || !report.supported || !report.supportsHighlights || (mode === 'watch' && report.runtime?.installed && report.runtime.version === version)) {
        windows.push({window:index + 1, ...report}); continue;
      }
      const result = await evaluate(target, '(' + installChatAnnotations.toString() + ')(' + readAnnotationSurface.toString() + ')');
      windows.push({window:index + 1, mode:report.mode, uiTheme:report.uiTheme, ...result});
    } catch {windows.push({window:index + 1, failed:true});}
  }
  return {checkedAt:new Date().toISOString(), version, windows};
}
async function main() {
  const allowed = new Set(['--check','--remove','--watch']);
  if (process.argv.slice(2).some(argument => !allowed.has(argument)) || process.argv.length > 3) throw Error('Use --check, --remove, --watch, or no arguments.');
  const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--remove') ? 'remove' : process.argv.includes('--watch') ? 'watch' : 'install';
  if (mode !== 'watch') {
    const result = await pass(mode); console.log(JSON.stringify(result, null, 2));
    if (mode === 'install' && !result.windows.some(window => window.installed)) process.exitCode = 1;
    if (mode === 'check' && !result.windows.some(window => window.supported && window.supportsHighlights)) process.exitCode = 1;
    return;
  }
  let stop = false, lastStatus = '';
  process.on('SIGINT', () => {stop = true;}); process.on('SIGTERM', () => {stop = true;});
  console.log('Annotations watcher active. Close this console or press Ctrl+C to stop automatic installation. Saved annotations remain local.');
  while (!stop) {
    let result;
    try {result = await pass('watch');} catch {result = {waitingForDebug:true};}
    const status = JSON.stringify(result.windows?.map(window => ({window:window.window,mode:window.mode,installed:window.installed || window.runtime?.installed || false,failed:!!window.failed})) || result);
    if (status !== lastStatus) {console.log(status); lastStatus = status;}
    if (!stop) await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
if (require.main === module) main().catch(error => {console.error('Annotations: ' + error.message); process.exitCode = 1;});
module.exports = {applicationReady, inspect, pass, removeAnnotations};
