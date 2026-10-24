'use strict';

// Runs inside the selected renderer. Text stays in DOM/memory; summaries contain counts only.
function installQuestionTimeline(readState, options = {}) {
  window.__questionTimelinePrototype?.destroy();
  let preferredSide;
  try { preferredSide = options.side || localStorage.getItem('question-timeline:side:v1'); } catch { preferredSide = options.side; }
  let side = preferredSide === 'left' ? 'left' : 'right';
  const host = document.createElement('div');
  host.setAttribute('data-question-timeline-prototype', '');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { font-family:inherit; color:var(--qt-ink,#29242a); }
    * { box-sizing:border-box; }
    .dock { position:absolute; width:44px; pointer-events:auto; }
    .tools { display:flex;flex-direction:column;align-items:flex-end;padding-right:2px;height:36px;opacity:0;transition:opacity .15s; }
    .dock[data-side="left"] .tools { align-items:flex-start;padding-right:0;padding-left:2px; }
    .dock:hover .tools,.dock:focus-within .tools { opacity:1; }
    .tool { position:relative;border:0;background:transparent;color:var(--qt-muted,#8c898e);width:18px;height:18px;padding:0;cursor:pointer;font-family:inherit;font-size:12px;line-height:18px; }
    .tool:hover { color:var(--qt-ink,#29242a); }
    .tool::after { content:attr(data-tooltip);display:none;position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);padding:6px 10px;border-radius:8px;background:#292729;color:#fff;box-shadow:0 4px 14px #00000020;font-family:inherit;font-size:12px;line-height:1.5;font-weight:500;white-space:nowrap;pointer-events:none;z-index:1; }
    .tool:hover::after,.tool:focus-visible::after { display:block; }
    .dock[data-side="left"] .tool::after { right:auto;left:calc(100% + 8px); }
    .rail { position:relative;width:44px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none; }
    .rail[data-fade-top="true"] { mask-image:linear-gradient(to bottom,transparent,#000 14px); }
    .rail[data-fade-bottom="true"] { mask-image:linear-gradient(to bottom,#000 calc(100% - 14px),transparent); }
    .rail[data-fade-top="true"][data-fade-bottom="true"] { mask-image:linear-gradient(to bottom,transparent,#000 14px,#000 calc(100% - 14px),transparent); }
    .rail::-webkit-scrollbar { display:none; }
    .ticks { display:flex;flex-direction:column;padding:3px 0; }
    .tick { position:relative;flex:none;display:flex;align-items:center;justify-content:flex-end;width:44px;height:10px;padding:0 8px 0 0;border:0;background:transparent;cursor:pointer; }
    .line { position:relative;display:block;flex-shrink:0;width:var(--tick-width,6px);height:2px;background:var(--qt-line,#cac7ca);transition:width .12s,background .12s; }
    .dock[data-side="left"] .tick { justify-content:flex-start;padding:0 0 0 8px; }
    .tick[data-bookmarked="true"] .line,.dock:not(.is-hovering) .tick[data-visible="true"] .line { background:var(--qt-mark,#746d79); }
    .tick[data-bookmarked="true"] .line::after { content:"";position:absolute;left:-4px;top:0;width:2px;height:2px;border-radius:50%;background:var(--qt-mark,#746d79); }
    .dock[data-side="left"] .tick[data-bookmarked="true"] .line::after { left:auto;right:-4px; }
    .tick[data-preview="true"] .line { background:var(--qt-ink,#29242a); }
    .tick:focus-visible { outline:1px solid var(--qt-muted,#8c898e);outline-offset:-1px;border-radius:2px; }
    .bubble { position:absolute;pointer-events:auto;width:320px;padding:8px;background:var(--qt-bg,#fff);border:1px solid var(--qt-border,#dedade);border-radius:14px;box-shadow:0 10px 28px #00000012; }
    .heading { display:flex;align-items:center;gap:8px; }
    .question { flex:1;min-width:0;font-size:13px;line-height:1.6;font-weight:var(--text-card-title--font-weight,600);color:color-mix(in srgb,var(--qt-ink,#29242a) 85%,var(--qt-muted,#8c898e));white-space:nowrap;text-overflow:ellipsis;overflow:hidden; }
    .bookmark { flex:none;width:20px;height:22px;padding:3px;border:0;background:transparent;color:var(--qt-muted,#8c898e);cursor:pointer; }
    .bookmark:hover,.bookmark[aria-pressed="true"] { color:var(--qt-ink,#29242a); }
    .bookmark svg { width:14px;height:16px;display:block;stroke-linecap:round;stroke-linejoin:round; }
    .bookmark[aria-pressed="true"] svg { fill:currentColor; }
    .answer { margin-top:5px;font-size:13px;line-height:1.6;color:var(--qt-muted,#8c898e);white-space:pre-line;overflow-wrap:anywhere;display:block;overflow:hidden; }
    .answer strong { font-weight:700; }
    .answer code { font:11px/1.6 var(--font-mono,ui-monospace,Consolas,monospace);background:var(--qt-code,#efedef);border-radius:3px;padding:0 3px;white-space:pre-wrap; }
    .answer .code-block { display:block; }
    .answer math { font-size:1em; }
    .answer .math-display { display:block;white-space:normal; }
    .status { margin-top:8px;font-size:11px;color:var(--qt-muted,#8c898e); }
    [hidden] { display:none!important; }
    @media(prefers-reduced-motion:reduce) { * { transition:none!important; } }
  </style>
  <div class="dock" hidden>
    <div class="tools"><button class="tool retry" aria-label="重新加载目录" data-tooltip="重新加载目录">↻</button><button class="tool side" aria-label="移到左侧" data-tooltip="移到左侧">‹</button></div>
    <nav class="rail" aria-label="提问目录"><div class="ticks"></div></nav>
  </div>
  <div class="bubble" role="region" aria-label="提问预览" id="qt-preview" hidden>
    <div class="heading"><div class="question"></div><button class="bookmark" aria-label="添加书签" aria-pressed="false" title="添加书签"><svg viewBox="0 0 20 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 2.75h9A3.25 3.25 0 0 1 17.75 6v14.1a1 1 0 0 1-1.55.83L10 17.25l-6.2 3.68a1 1 0 0 1-1.55-.83V6A3.25 3.25 0 0 1 5.5 2.75Z"/></svg></button></div>
    <div class="answer" hidden></div><div class="status" hidden></div>
  </div>`;
  document.body.append(host);
  const find = selector => shadow.querySelector(selector);
  const dock = find('.dock'), rail = find('.rail'), ticks = find('.ticks'), bubble = find('.bubble');
  const question = find('.question'), answer = find('.answer'), bookmark = find('.bookmark'), status = find('.status'), retry = find('.retry');
  let state = null, context = null, root = null, signature = '', buttons = [], hoverIndex = -1;
  let destroyed = false, loading = false, loadAbort = null, jumpAbort = null, frame = null, error = '', activeIndex = -1;
  let loadAttempted = false, loadSucceeded = false;
  let hideTimer = null, pointerMode = true, hiddenReason = '', marks = new Set(), hoverPosition = -1;
  let renderedReply = null, fullAnswer = null, answerWidth = 0, answerFont = '';
  const bookmarkCache = window.__questionTimelineBookmarkCache ||= new Map();

  function setHover(index, position = index) {
    const previous = hoverIndex;
    hoverIndex = index;
    hoverPosition = position;
    dock.classList.toggle('is-hovering', index >= 0);
    const changed = new Set();
    for (const center of [previous, index]) if (center >= 0) for (let i = Math.max(0, center - 5); i <= Math.min(buttons.length - 1, center + 5); i++) changed.add(i);
    for (const i of changed) {
      const distance = index < 0 ? Infinity : Math.abs(i - position);
      buttons[i].style.setProperty('--tick-width', (6 + (distance <= 5 ? 20 * Math.exp(-distance * distance / 5.12) : 0)).toFixed(2) + 'px');
      buttons[i].setAttribute('data-preview', String(i === index));
    }
  }
  function cancelHide() { clearTimeout(hideTimer); hideTimer = null; }
  function hidePreview() { cancelHide(); bubble.hidden = true; setHover(-1); }
  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(() => {
      if (dock.matches(':hover') || bubble.matches(':hover')) return;
      if (!pointerMode && (dock.contains(shadow.activeElement) || bubble.contains(shadow.activeElement))) return;
      hidePreview();
    }, 220);
  }
  function readMarks() {
    const store=window.__chatAnnotationStoreV1;
    if(store?.syncBookmarks) {
      try {marks=store.syncBookmarks(context,state?.entries||[]);return;} catch { /* Preserve existing marks if persistence is unavailable. */ }
    }
    if (!bookmarkCache.has(context)) {
      let stored = [];
      try { const data = JSON.parse(localStorage.getItem('question-timeline:bookmarks:v1:' + context) || '[]'); if (Array.isArray(data)) stored = data.filter(key => typeof key === 'string'); } catch { /* Memory fallback if local storage is unavailable. */ }
      bookmarkCache.set(context, new Set(stored));
    }
    marks = bookmarkCache.get(context);
  }
  function updateMarks() {
    buttons.forEach((button, index) => button.setAttribute('data-bookmarked', String(marks.has(state.entries[index].key))));
    const marked = !!state?.entries[hoverIndex] && marks.has(state.entries[hoverIndex].key);
    bookmark.setAttribute('aria-pressed', String(marked));
    bookmark.setAttribute('aria-label', marked ? '取消书签' : '添加书签');
    bookmark.title = marked ? '取消书签' : '添加书签';
  }
  function layout() {
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    // Scrollbar and border pixels are outside the space available to the timeline.
    const left = Math.max(0, bounds.left + root.clientLeft), right = Math.min(innerWidth, bounds.right, bounds.left + root.clientLeft + root.clientWidth);
    const top = Math.max(0, bounds.top + root.clientTop), bottom = Math.min(innerHeight, bounds.bottom, bounds.top + root.clientTop + root.clientHeight);
    // Single pass over visible turn elements for both margin check and active turn tracking.
    const indices = new Map(state.entries.map((entry, index) => [entry.key, index]));
    const position = top + Math.min(60, (bottom - top) * .15);
    let contentRight = -Infinity, contentLeft = Infinity, hasContent = false;
    let nextActive = -1, nearest = Infinity;
    const visible = new Set();
    for (const element of root.querySelectorAll('[data-turn-key]')) {
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom <= top || r.top >= bottom) continue;
      hasContent = true;
      if (r.right > contentRight) contentRight = r.right;
      if (r.left < contentLeft) contentLeft = r.left;
      const candidate = indices.get(element.getAttribute('data-turn-key'));
      if (candidate !== undefined) {
        visible.add(candidate);
        const distance = position < r.top ? r.top - position : position > r.bottom ? position - r.bottom : 0;
        if (distance < nearest) { nextActive = candidate; nearest = distance; }
      }
    }
    if (!hasContent) { contentRight = right; contentLeft = left; }
    const margin = side === 'left' ? contentLeft - left : right - contentRight;
    hiddenReason = margin < 68 ? 'insufficient-margin' : bottom - top < 100 ? 'insufficient-height' : '';
    dock.hidden = !!hiddenReason;
    if (dock.hidden) { hidePreview(); return; }
    const available = Math.max(10, Math.min(innerHeight * .6 - 36, bottom - top - 48));
    rail.style.maxHeight = available + 'px';
    const height = Math.min(available, buttons.length * 10 + 6) + 36;
    dock.style.left = (side === 'left' ? left : right - 44) + 'px';
    dock.style.top = top + (bottom - top - height) / 2 + 'px';
    const rootStyle = getComputedStyle(root);
    host.style.fontFamily = rootStyle.fontFamily || 'inherit';
    host.style.fontWeight = rootStyle.fontWeight || 'inherit';
    const rgb = rootStyle.color.match(/[\d.]+/g)?.map(Number);
    const dark = rgb && (rgb[0] + rgb[1] + rgb[2]) / 3 > 150;
    host.style.setProperty('--qt-bg', dark ? '#252426' : '#fffdfd');
    host.style.setProperty('--qt-ink', dark ? '#f0edf1' : '#29242a');
    host.style.setProperty('--qt-muted', dark ? '#aaa5ad' : '#8c898e');
    host.style.setProperty('--qt-line', dark ? '#67636a' : '#ccc8cc');
    host.style.setProperty('--qt-mark', dark ? '#bfb7c7' : '#746d79');
    host.style.setProperty('--qt-border', dark ? '#49454c' : '#ddd8dd');
    host.style.setProperty('--qt-code', dark ? '#363237' : '#efedef');
    active({ index: nextActive, visible });
  }
  function renderAnswer(markdown) {
    // Create formatting nodes explicitly. Conversation HTML and image/link URLs
    // are never inserted or fetched; only our local formula renderer emits markup.
    answer.replaceChildren();
    function inline(parent, text, depth = 0) {
      if (depth > 8) { parent.append(document.createTextNode(text)); return; }
      const pattern = /```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]+`|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$(?![\s$])(?:\\.|[^$\n])*?[^\s\\]\$(?!\d)|!?\[[^\]\n]*\]\([^\n)]*\)|\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*(?!\*)|__[\s\S]+?__(?!_)|~~[\s\S]+?~~|\*(?!\s)[^*\n]+?\*|(?<!\w)_(?!\s)[^_\n]+?_(?!\w)|\\[\\`*_[\]~$]/g;
      let cursor = 0;
      for (const match of text.matchAll(pattern)) {
        if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index).replace(/^ {0,3}(?:#{1,6}\s+|>\s?)/gm, '')));
        const token = match[0];
        if (token.startsWith('```') || token.startsWith('`')) {
          const node = document.createElement('code');
          if (token.startsWith('```')) { node.className = 'code-block'; node.textContent = token.slice(token.indexOf('\n') + 1).replace(/```$/, ''); }
          else node.textContent = token.slice(1, -1);
          parent.append(node);
        } else if (token.startsWith('\\(') || token.startsWith('\\[') || token.startsWith('$')) {
          const display = token.startsWith('\\[') || token.startsWith('$$'), delimiter = token.startsWith('\\') || display ? 2 : 1;
          const tex = token.slice(delimiter, -delimiter), node = document.createElement('span');
          if (display) node.className = 'math-display';
          try {
            if (typeof options.renderMath !== 'function') throw Error('No math renderer');
            const parsed = new DOMParser().parseFromString(options.renderMath(tex, display), 'text/html');
            const math = parsed.querySelector('math');
            if (!math) throw Error('No formula');
            node.append(document.importNode(math, true));
          } catch (error) { if (options.renderMath) options.onDiagnostic?.('preview', 'math-render-fallback', error); node.textContent = token; }
          parent.append(node);
        } else if (token.startsWith('[') || token.startsWith('![')) {
          inline(parent, token.slice(token.indexOf('[') + 1, token.indexOf(']')), depth + 1);
        } else if (token.startsWith('\\')) parent.append(document.createTextNode(token.slice(1)));
        else {
          const marker = token.startsWith('***') ? 3 : /^(\*\*|__|~~)/.test(token) ? 2 : 1;
          const node = document.createElement(token.startsWith('~~') ? 's' : marker > 1 ? 'strong' : 'em');
          if (marker === 3) { const em = document.createElement('em'); inline(em, token.slice(3, -3), depth + 1); node.append(em); }
          else inline(node, token.slice(marker, -marker), depth + 1);
          parent.append(node);
        }
        cursor = match.index + token.length;
      }
      if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor).replace(/^ {0,3}(?:#{1,6}\s+|>\s?)/gm, '')));
    }
    inline(answer, markdown.slice(0, 5000));
  }
  function fitAnswer() {
    // Measure visual rows in DOM order. A formula is one indivisible unit;
    // intersecting row bands keeps a tall inline fraction with its text baseline.
    const range = document.createRange(), rows = [];
    let cut = null, closedRow = false;
    const segments = new Intl.Segmenter(undefined, {granularity:'grapheme'});
    function accept(rect, point, block = false) {
      if (!rect.width || !rect.height) return true;
      const row = rows.at(-1);
      const overlap = row && Math.min(row.bottom, rect.bottom) - Math.max(row.top, rect.top);
      if (!row || closedRow || block || overlap < Math.min(row.bottom - row.top, rect.height) * .4) {
        if (rows.length === 3) { cut = point; return false; }
        rows.push({top:rect.top, bottom:rect.bottom});
      } else { row.top = Math.max(row.top,rect.top); row.bottom = Math.min(row.bottom,rect.bottom); }
      closedRow = block;
      return true;
    }
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const part of segments.segment(node.data)) {
          if (!part.segment.trim()) continue;
          range.setStart(node,part.index); range.setEnd(node,part.index + part.segment.length);
          if (!accept(range.getBoundingClientRect(),{node,offset:part.index})) return false;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.localName === 'math' || node.classList.contains('math-display')) {
          const point = {node:node.parentNode,offset:[...node.parentNode.childNodes].indexOf(node)};
          return accept(node.getBoundingClientRect(),point,node.classList.contains('math-display'));
        }
        for (const child of [...node.childNodes]) if (!visit(child)) return false;
      }
      return true;
    }
    for (const node of [...answer.childNodes]) if (!visit(node)) break;
    if (!cut) return;
    range.setStart(cut.node,cut.offset); range.setEnd(answer,answer.childNodes.length); range.deleteContents();
    // Remove the final line break before appending a continuation mark. If a
    // whole formula fills the last row, omit the mark rather than crop it.
    const walker = document.createTreeWalker(answer,NodeFilter.SHOW_TEXT);
    let last = null, node;
    while (node = walker.nextNode()) if (!node.parentElement.closest('math')) last = node;
    if (last && !last.nextSibling) last.data = last.data.replace(/\s+$/,'');
    const more = document.createElement('span'); more.textContent = '…'; answer.append(more);
    const row = rows.at(-1);
    const markFits = () => {
      const rect = more.getBoundingClientRect();
      return Math.min(row.bottom,rect.bottom) - Math.max(row.top,rect.top) >= Math.min(row.bottom-row.top,rect.height) * .4;
    };
    if (!markFits() && !answer.querySelector('math') && last?.isConnected) {
      // Reserve a few glyphs for the continuation mark on an ordinary text row.
      for (const part of [...segments.segment(last.data)].reverse()) {
        last.deleteData(part.index,part.segment.length);
        if (markFits()) break;
      }
    }
    if (!markFits()) more.remove();
  }
  function showPreview(index, message = '', keepHideTimer = false) {
    if (dock.hidden || !state?.entries[index]) return;
    if (!keepHideTimer) cancelHide();
    setHover(index, keepHideTimer && index === hoverIndex ? hoverPosition : index);
    const text = state.entries[index].text || '（图片、文件或其他输入）';
    const title = text.replace(/\s+/g, ' ').trim(), reply = state.entries[index].answer || '';
    if (question.textContent !== title) question.textContent = title;
    const replyChanged = renderedReply !== reply;
    if (replyChanged) { renderAnswer(reply); fullAnswer = answer.cloneNode(true); renderedReply = reply; }
    answer.hidden = !reply.trim();
    updateMarks();
    status.textContent = message;
    status.hidden = !message;
    bubble.hidden = false;
    const bounds = buttons[index].getBoundingClientRect(), dockBounds = dock.getBoundingClientRect();
    const gap = 0, edge = 8;
    const space = side === 'left' ? innerWidth - dockBounds.right - gap - edge : dockBounds.left - gap - edge;
    const width = Math.min(320, Math.max(160, space));
    bubble.style.width = width + 'px';
    const previewFont = getComputedStyle(answer).font;
    if (!answer.hidden && (replyChanged || answerWidth !== answer.clientWidth || answerFont !== previewFont)) {
      answerWidth = answer.clientWidth; answerFont = previewFont;
      answer.replaceChildren(...[...fullAnswer.childNodes].map(node=>node.cloneNode(true)));
      fitAnswer();
    }
    bubble.style.left = (side === 'left' ? Math.min(innerWidth - width - edge, dockBounds.right + gap) : Math.max(edge, dockBounds.left - width - gap)) + 'px';
    bubble.style.top = Math.max(8, Math.min(innerHeight - bubble.offsetHeight - 8, bounds.top - 18)) + 'px';
  }
  function active(prefetched) {
    frame = null;
    if (!state || !root) return;
    // Native ChatGPT uses column-reverse and negative scrollTop. Mounted DOM
    // coordinates also avoid errors from estimated heights in the virtual list.
    let index = -1, visible;
    if (prefetched) {
      ({ index, visible } = prefetched);
    } else {
      const viewport = root.getBoundingClientRect();
      const top = Math.max(0, viewport.top + root.clientTop), bottom = Math.min(innerHeight, viewport.bottom, viewport.top + root.clientTop + root.clientHeight);
      const position = top + Math.min(60, (bottom - top) * .15);
      const indices = new Map(state.entries.map((entry, index) => [entry.key, index]));
      let nearest = Infinity;
      visible = new Set();
      for (const element of root.querySelectorAll('[data-turn-key]')) {
        const candidate = indices.get(element.getAttribute('data-turn-key'));
        if (candidate === undefined) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom <= top || bounds.top >= bottom || bounds.height <= 0) continue;
        visible.add(candidate);
        const distance = position < bounds.top ? bounds.top - position : position > bounds.bottom ? position - bounds.bottom : 0;
        if (distance < nearest) { index = candidate; nearest = distance; }
      }
    }
    if (index < 0) return;
    buttons.forEach((button, i) => button.setAttribute('data-visible', String(visible.has(i))));
    if (activeIndex === index) return;
    activeIndex = index;
    buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
    const button = buttons[index];
    if (button && hoverIndex < 0 && !rail.matches(':hover') && !shadow.activeElement) {
      if (button.offsetTop < rail.scrollTop + 16) rail.scrollTop = Math.max(0, button.offsetTop - 16);
      else if (button.offsetTop + button.offsetHeight > rail.scrollTop + rail.clientHeight - 16) rail.scrollTop = button.offsetTop + button.offsetHeight - rail.clientHeight + 16;
    }
  }
  function scheduleActive() { if (frame === null) frame = requestAnimationFrame(active); }
  function updateFade() {
    const overflow = rail.scrollHeight > rail.clientHeight + 1;
    rail.setAttribute('data-fade-top', String(overflow && rail.scrollTop > 1));
    rail.setAttribute('data-fade-bottom', String(overflow && rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1));
  }
  function applySide() {
    dock.setAttribute('data-side', side);
    const toggle = find('.side');
    toggle.textContent = side === 'left' ? '›' : '‹';
    const label = side === 'left' ? '移到右侧' : '移到左侧';
    toggle.setAttribute('data-tooltip', label);
    toggle.setAttribute('aria-label', label);
    try { localStorage.setItem('question-timeline:side:v1', side); } catch { /* Current instance still remembers its side. */ }
  }
  async function jump(index) {
    const selected = state?.entries[index], expectedContext = context;
    if (!selected) return;
    const current = readState();
    if (!current || current.contextId !== expectedContext || current.root !== root) { refresh(); return; }
    jumpAbort?.abort();
    const controller = jumpAbort = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    showPreview(index, '正在定位…');
    try {
      await current.api.scrollToKey(selected.key, undefined, { align: 'top', signal: controller.signal });
      controller.signal.throwIfAborted();
      if (destroyed || context !== expectedContext || readState()?.contextId !== expectedContext) return;
      scheduleActive();
      if (hoverIndex === index) showPreview(index);
    } catch (error) {
      if (!destroyed && jumpAbort === controller && context === expectedContext) options.onDiagnostic?.('jump', controller.signal.aborted ? 'jump-timeout' : 'jump-failed', error);
      if (!destroyed && jumpAbort === controller && context === expectedContext && hoverIndex === index) showPreview(index, '定位未完成，请重试');
    } finally { clearTimeout(timer); if (jumpAbort === controller) jumpAbort = null; }
  }
  function render() {
    // Assistant streaming changes should update the preview without rebuilding the rail.
    const nextSignature = state.entries.map(entry => entry.key + '\0' + entry.text).join('\u0001');
    if (signature === nextSignature) return;
    signature = nextSignature;
    hidePreview();
    ticks.replaceChildren();
    buttons = state.entries.map((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'tick';
      const line = document.createElement('span'); line.className = 'line'; line.setAttribute('aria-hidden', 'true'); button.append(line);
      button.setAttribute('aria-label', `第 ${index + 1} 次提问：${entry.text.slice(0, 180) || '图片或文件输入'}`);
      button.setAttribute('aria-describedby', 'qt-preview');
      button.addEventListener('mouseenter', () => { pointerMode = true; showPreview(index); });
      button.addEventListener('focus', () => showPreview(index));
      button.addEventListener('blur', scheduleHide);
      button.addEventListener('click', () => jump(index));
      button.addEventListener('keydown', event => {
        pointerMode = false;
        let next = index;
        if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, index + 1);
        else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else if (event.key === 'Escape') { hidePreview(); button.blur(); return; }
        else return;
        event.preventDefault(); buttons[next]?.focus();
      });
      ticks.append(button); return button;
    });
    updateMarks();
    activeIndex = -1;
  }
  async function loadHistory() {
    if (loading || !state?.loadHistory || state.complete) return;
    loadAttempted = true; loading = true; error = '';
    const expectedContext = context, expectedRoot = root;
    const controller = loadAbort = new AbortController();
    const load = state.loadHistory;
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      await load(controller.signal);
      controller.signal.throwIfAborted();
      if (!destroyed && context === expectedContext && root === expectedRoot) loadSucceeded = true;
    } catch (cause) {
      if (!destroyed && context === expectedContext && root === expectedRoot) options.onDiagnostic?.('history-load', controller.signal.aborted ? 'history-load-timeout' : 'history-load-failed', cause);
      if (!destroyed && context === expectedContext && root === expectedRoot && !controller.signal.aborted) error = '加载失败';
      else if (!destroyed && context === expectedContext && root === expectedRoot) error = '加载超时';
    } finally {
      clearTimeout(timer);
      if (loadAbort === controller) { loadAbort = null; loading = false; if (!destroyed) refresh(); }
    }
  }
  function refresh() {
    try { refreshState(); } catch (error) { options.onDiagnostic?.('refresh', 'ui-refresh-failed', error); }
  }
  function refreshState() {
    if (destroyed) return;
    let next;
    try { next = readState(); } catch (error) { options.onDiagnostic?.('adapter', 'adapter-read-failed', error); next = null; }
    if (!next?.entries?.length) {
      loadAbort?.abort(); jumpAbort?.abort();
      loadAbort = jumpAbort = null; loading = false;
      root?.removeEventListener('scroll', scheduleActive);
      root = null; state = null; context = null; signature = ''; loadAttempted = false;
      resizeObserver.disconnect(); hiddenReason = 'no-conversation';
      dock.hidden = true; hidePreview(); return;
    }
    // Keep the rail inside the chat surface's stacking context so native sidebar
    // previews, menus and dialogs can cover it. Follow replacement chat surfaces.
    const layerRoot = next.root.closest('main') || document.body;
    if (host.parentElement !== layerRoot) layerRoot.append(host);
    if (next.contextId !== context || next.root !== root) {
      loadAbort?.abort(); jumpAbort?.abort(); loadAbort = jumpAbort = null;
      root?.removeEventListener('scroll', scheduleActive);
      root = next.root; context = next.contextId; signature = ''; activeIndex = -1;
      resizeObserver.disconnect(); resizeObserver.observe(root);
      loading = false; loadAttempted = false; loadSucceeded = false; error = '';
      root.addEventListener('scroll', scheduleActive, { passive: true });
    }
    state = next;
    readMarks();
    render(); updateMarks(); layout();
    updateFade();
    retry.disabled = loading;
    retry.setAttribute('data-tooltip', loading ? '正在加载历史' : error || '重新加载目录');
    if (hoverIndex >= 0) showPreview(hoverIndex, '', true);
    if (!dock.hidden && !loadAttempted && !state.complete) void loadHistory();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; clearInterval(interval);
    cancelHide(); resizeObserver.disconnect();
    loadAbort?.abort(); jumpAbort?.abort();
    if (frame !== null) cancelAnimationFrame(frame);
    root?.removeEventListener('scroll', scheduleActive);
    window.removeEventListener('resize', refresh); host.remove();
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('keydown', keyboardMode, true);
    if (window.__questionTimelinePrototype === handle) delete window.__questionTimelinePrototype;
    state = null; buttons = [];
  }
  function annotationNavigation(expectedContext) {
    if (destroyed || !expectedContext?.startsWith('chatgpt:')) return null;
    const current = readState();
    if (!current || current.contextId !== expectedContext || !current.api?.scrollToKey) return null;
    const targets = new Map(), ambiguous = new Set();
    for (const entry of current.entries) for (const id of entry.assistantMessageIds || []) {
      if (targets.has(id) && targets.get(id) !== entry.key) ambiguous.add(id);
      targets.set(id, entry.key);
    }
    for (const id of ambiguous) targets.delete(id);
    return {
      has: id => targets.has(id),
      async jump(id, signal) {
        signal?.throwIfAborted();
        const latest = annotationNavigation(expectedContext);
        if (!latest?.has(id) || destroyed) return false;
        const next = readState();
        if (next?.contextId !== expectedContext || next.root !== current.root) return false;
        const matches = next.entries.filter(entry => entry.assistantMessageIds?.includes(id));
        if (matches.length !== 1) return false;
          await next.api.scrollToKey(matches[0].key, undefined, {align:'top',signal});
          signal?.throwIfAborted();
          const after = readState();
          return !destroyed && after?.contextId === expectedContext && after.root === current.root;
      },
    };
  }
  function syncBookmarks(expectedContext) {
    const current=readState();
    if(current?.contextId===expectedContext)window.__chatAnnotationStoreV1?.syncBookmarks(expectedContext,current.entries);
  }
  const handle = { destroy, annotationNavigation, syncBookmarks, summary: () => ({ installed: !destroyed, toolVersion: options.toolVersion || null, hasAnnotationNavigation:true, visible: !dock.hidden, questionCount: state?.entries.length || 0,
    complete: state?.complete === true, loading, loadSucceeded, hasError: !!error, hiddenReason, side,
    currentTurn: activeIndex >= 0 ? activeIndex + 1 : null, mathRendering:typeof options.renderMath === 'function' }) };
  window.__questionTimelinePrototype = handle;
  find('.side').addEventListener('click', () => { side = side === 'left' ? 'right' : 'left'; applySide(); hidePreview(); refresh(); });
  find('.retry').addEventListener('click', () => { loadAttempted = false; error = ''; refresh(); });
  dock.addEventListener('mouseenter', cancelHide);
  dock.addEventListener('mouseleave', scheduleHide);
  bubble.addEventListener('mouseenter', cancelHide);
  bubble.addEventListener('mouseleave', scheduleHide);
  bubble.addEventListener('focusin', cancelHide);
  bubble.addEventListener('focusout', scheduleHide);
  bubble.addEventListener('keydown', event => { if (event.key === 'Escape') { buttons[activeIndex]?.focus(); hidePreview(); } });
  bookmark.addEventListener('click', () => {
    const current = readState(), entry = state?.entries[hoverIndex];
    if (!entry || !current || current.contextId !== context || current.root !== root) { refresh(); return; }
    if (marks.has(entry.key)) marks.delete(entry.key); else marks.add(entry.key);
    try {
      const store=window.__chatAnnotationStoreV1;
      if(store?.toggleBookmark){store.toggleBookmark(context,entry);marks=store.syncBookmarks(context,current.entries);}
      else localStorage.setItem('question-timeline:bookmarks:v1:' + context, JSON.stringify([...marks]));
    } catch { /* The memory cache still supports marks within this session. */ }
    updateMarks();
  });
  rail.addEventListener('scroll', () => {
    updateFade();
    if (!pointerMode) return;
    hidePreview();
  }, { passive: true });
  rail.addEventListener('mousemove', event => {
    const button = event.target.closest('.tick'), index = buttons.indexOf(button);
    if (index < 0) return;
    pointerMode = true;
    if (hoverIndex !== index) showPreview(index);
    const position = (event.clientY - rail.getBoundingClientRect().top + rail.scrollTop - 3) / 10 - .5;
    setHover(index, position);
  });
  function keyboardMode(event) { if (event.key === 'Tab') pointerMode = false; }
  function visibilityChanged() { if (!document.hidden) refresh(); }
  window.addEventListener('keydown', keyboardMode, true);
  window.addEventListener('resize', refresh);
  document.addEventListener('visibilitychange', visibilityChanged);
  const resizeObserver = new ResizeObserver(refresh);
  const interval = setInterval(() => { if (!document.hidden) refresh(); }, 1200);
  applySide();
  refresh();
  return handle.summary();
}
if (typeof module !== 'undefined') module.exports = { installQuestionTimeline };
