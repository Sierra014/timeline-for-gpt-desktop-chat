'use strict';

function installChatAnnotations(readSurface, options = {}) {
  window.__chatAnnotationsV1?.destroy();
  for (const element of document.querySelectorAll('#chat-annotations-v1,style[data-chat-annotations-style="v1"]')) element.remove();
  if (!CSS.highlights || typeof Highlight !== 'function') return {installed: false, reason: 'highlight-api-unavailable'};
  let surface = readSurface();
  if (!surface) return {installed: false, reason: 'answer-dom-unavailable'};
  const version = '0.1.23', storagePrefix = 'chat-annotations:v1:', colors = ['pink', 'yellow', 'green'];
  const store = window.__chatAnnotationStoreV1 || null, dirtyContexts = new Set();
  const names = colors.map(color => 'chat-annotations-' + color);
  const excluded = 'script,style,button,input,textarea,[contenteditable="true"],[aria-hidden="true"],.sr-only,math,.katex,svg';
  const mathSelector = '.katex,[data-math-source],math';
  const host = document.createElement('div'); host.id = 'chat-annotations-v1';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50';
  const shadow = host.attachShadow({mode: 'open'});
  shadow.innerHTML = `<style>
    :host{font-family:inherit;font-size:13px;line-height:1.5;color:var(--ink,#29262b);--paper:#fffdfd;--line:#dedade;--muted:#87818a;--soft:#f3f0f3;--annotation-accent:#e83e76;--dock-hover:#e9e5e8;--dock-active:#eadce2;--scroll-thumb:#dedbde;--scroll-hover:#c6c0c5}
    *{box-sizing:border-box}[hidden]{display:none!important}button,textarea{font:inherit;color:inherit}
    button{cursor:pointer;border:0;background:transparent}button:focus-visible{outline:2px solid var(--annotation-accent);outline-offset:2px}
    .dock,.card,.navigator,.preview{position:fixed;pointer-events:auto}
    .dock{visibility:hidden;display:flex;gap:3px;color:var(--muted)}.dock button{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;padding:0;background:var(--soft)}.dock button:hover{background:var(--dock-hover)}.dock svg{width:17px;height:17px;stroke-linecap:round;stroke-linejoin:round}
    .mode-toggle[aria-pressed="true"]{background:var(--dock-active);color:var(--ink)}
    .card,.navigator,.navigator-scroll,.preview,textarea{scrollbar-color:auto;scrollbar-width:auto}
    ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{background:var(--scroll-thumb);border-radius:99px;min-height:24px}::-webkit-scrollbar-thumb:hover{background:var(--scroll-hover)}::-webkit-scrollbar-button{display:none;width:0;height:0}
    .navigator-scroll::-webkit-scrollbar-button:vertical:decrement:start,.navigator-scroll::-webkit-scrollbar-button:vertical:increment:end{display:block;width:6px;height:11px;background-color:transparent;background-position:center;background-repeat:no-repeat;background-size:6px 4px}
    .navigator-scroll::-webkit-scrollbar-button:vertical:decrement:start{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 6 4'%3E%3Cpath fill='%23b6b2b7' d='M0 4 3 0 6 4Z'/%3E%3C/svg%3E")}
    .navigator-scroll::-webkit-scrollbar-button:vertical:increment:end{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 6 4'%3E%3Cpath fill='%23b6b2b7' d='M0 0 6 0 3 4Z'/%3E%3C/svg%3E")}
    .navigator-scroll::-webkit-scrollbar-button:hover{background-color:var(--soft)}
    .card,.navigator,.preview{background:var(--paper);border:1px solid var(--line);box-shadow:0 12px 32px #00000018;overscroll-behavior:contain}
    .card{width:320px;max-width:calc(100vw - 20px);max-height:65vh;overflow:auto;border-radius:13px;padding:12px;box-shadow:0 12px 32px #00000018}
    .close{position:absolute;right:8px;top:8px;width:25px;height:25px;border-radius:6px;font-size:19px;color:var(--muted)}.close:hover{background:var(--soft)}
    .palette{display:flex;align-items:center;gap:9px;margin:1px 28px 12px 1px;height:25px}
    .swatch{width:22px;height:22px;border-radius:50%;border:2px solid transparent;background-clip:padding-box}.swatch[aria-pressed="true"]{outline:1px solid var(--ink);outline-offset:2px}
    textarea{display:block;width:100%;resize:vertical;height:calc(3.2em + 18px);min-height:calc(3.2em + 18px);max-height:180px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--paper);line-height:1.6}textarea:focus{border-color:var(--annotation-accent);outline:none;box-shadow:0 0 0 .5px var(--annotation-accent)}
    textarea::placeholder{color:var(--muted)}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:11px}.actions button{padding:5px 10px;border-radius:7px}.save{background:var(--ink);color:var(--paper)}.delete{margin-right:auto;color:#b44460}
    .navigator{width:272px;max-width:calc(100vw - 20px);max-height:55vh;overflow:hidden;border-radius:15px;padding:6px 2px 6px 6px}.navigator-scroll{max-height:calc(55vh - 14px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;border-radius:9px;scrollbar-gutter:stable;padding-right:8px}.list{display:flex;flex-direction:column;gap:0}.item{position:relative;text-align:left;padding:6px 11px 6px 24px;border:0;border-radius:10px;width:100%;flex:none;min-width:0}.item::before{content:"-";position:absolute;left:10px;top:6px;color:var(--muted);font-size:13px}.item:not(:disabled):hover{background:var(--soft)}.item:disabled{color:var(--muted);cursor:default}
    .item-quote,.item-note{display:flex;align-items:baseline;min-width:0;white-space:nowrap;overflow:hidden;font-size:13px}.quote-content{display:block;flex:1;min-width:0;overflow:hidden}.quote-ellipsis{flex:none}.item-quote,.item-note,.preview{font-family:var(--annotation-text-font,inherit)}.item-quote mtext{font-family:var(--annotation-text-font,inherit)}.item-quote math{display:inline math;font-size:1em;font-family:"Cambria Math",math;vertical-align:baseline}.item-note{color:var(--muted);font-size:12px;margin-top:1px}
    .empty{font-size:12px;color:var(--muted);padding:10px 11px}
    .preview{width:max-content;max-width:min(300px,calc(100vw - 20px));max-height:30vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.65}
    .tooltip,.toast{position:fixed;padding:6px 10px;border-radius:8px;background:#28252a;color:white;pointer-events:none;font-size:12px;box-shadow:0 4px 12px #0002}.tooltip{white-space:nowrap}.toast{left:50%;bottom:30px;transform:translateX(-50%);max-width:calc(100vw - 30px)}
  </style>
  <div class="dock"><button class="mode-toggle" aria-label="标注" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 11 7-7a2.1 2.1 0 0 1 3 3l-7 7M9 11l3 3M9 11c-3 0-4 2-4 4 0 2-1 3-2 4 5 1 9-1 9-5"/></svg></button><button class="list-open" aria-label="标注导航" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3h8a2 2 0 0 1 2 2v14a1 1 0 0 1-1.6.8l-3.8-2.85a1 1 0 0 0-1.2 0L7.6 19.8A1 1 0 0 1 6 19V5a2 2 0 0 1 2-2Z"/></svg></button></div>
  <section class="card" role="dialog" aria-label="本地标注" hidden>
    <button class="close" aria-label="关闭标注卡片">×</button>
    <div class="palette"></div><textarea aria-label="我的注释" placeholder="添加注释" rows="2" maxlength="10000"></textarea><div class="actions"><button class="delete" hidden>删除</button><button class="save">保存标注</button></div>
  </section><section class="navigator" aria-label="标注导航" hidden><div class="navigator-scroll"><div class="list"></div></div></section>
  <div class="preview" role="tooltip" hidden></div><div class="tooltip" role="tooltip" hidden>标注</div><div class="toast" role="status" hidden></div>`;
  const style = document.createElement('style'); style.dataset.chatAnnotationsStyle = 'v1';
  style.textContent = '::highlight(chat-annotations-yellow){background-color:#efc74366}::highlight(chat-annotations-green){background-color:#48c48e55}::highlight(chat-annotations-pink){background-color:#ed77aa55}[data-chat-annotations-menu-hidden="v1"]{visibility:hidden!important}';
  document.head.append(style); document.body.append(host);
  const $ = selector => shadow.querySelector(selector);
  const dock = $('.dock'), card = $('.card'), navigator = $('.navigator'), list = $('.list'), noteInput = $('textarea'), preview = $('.preview'), tooltip = $('.tooltip');
  let records = [], matches = new Map(), statuses = new Map(), pending = null, editing = null, chosenColor = 'pink';
  let saved = true, destroyed = false, ready = false, observer = null, timer = 0, frame = 0, refreshTimer = 0, toastTimer = 0, context = '', lastRect = null;
  const memory = new Map(), hiddenMenus = new Set();
  let hoverTimer = 0, hoverFrame = 0, hoverPoint = null, hoveredId = null, previewRect = null, pressPoint = null;
  let previewId = null, listSignature = '';
  const quoteLayouts = new WeakMap(), segmenter = new Intl.Segmenter(undefined,{granularity:'grapheme'});
  let annotationMode = false;
  let historyReady = new Set(), navigationAbort = null;
  const i18n = {
    zh: {
      annotate: '标注', nav: '标注导航', cardLabel: '本地标注', close: '关闭标注卡片',
      noteLabel: '我的注释', notePlaceholder: '添加注释', delete: '删除', save: '保存标注',
      empty: '暂无标注', sep: '，',
      swatches: { pink: '主题色高亮', yellow: '黄色高亮', green: '伴随色高亮' },
      inHistory: '历史待定位', unloaded: '原文尚未加载', changed: '原文已变化或定位不唯一',
      unannotatable: '原文暂不可标注', located: '已定位',
      readFailed: '本地标注无法读取，本次会话不覆盖原数据。',
      storageUnavailable: '标注存储不可用，未保存。请检查存储后重新加载标注工具。',
      saveFailed: '保存失败，标注卡片已保留。请检查本地存储空间。',
      locateFailed: '原文尚未恢复或已变化，未定位标注。',
      historyFailed: '历史定位未完成，请稍后重试。'
    },
    en: {
      annotate: 'Annotate', nav: 'Annotations', cardLabel: 'Local annotation', close: 'Close',
      noteLabel: 'My note', notePlaceholder: 'Add a note…', delete: 'Delete', save: 'Save',
      empty: 'No annotations yet', sep: ', ',
      swatches: { pink: 'Theme highlight', yellow: 'Yellow highlight', green: 'Companion highlight' },
      inHistory: 'In history', unloaded: 'Source not loaded', changed: 'Source changed or ambiguous',
      unannotatable: 'Cannot highlight source', located: 'Located',
      readFailed: 'Could not read local annotations; existing data will not be overwritten.',
      storageUnavailable: 'Annotation storage unavailable; not saved. Check storage and reload.',
      saveFailed: 'Save failed; card kept open. Please check local storage space.',
      locateFailed: 'Source text not restored or changed; could not locate annotation.',
      historyFailed: 'History jump incomplete, please retry.'
    }
  };
  let lang = '', uiTheme = null;
  function detectLang() {
    const raw = (typeof document !== 'undefined' && document.documentElement?.lang) || (typeof navigator !== 'undefined' && navigator.language) || 'zh';
    return /^zh\b/i.test(raw) ? 'zh' : 'en';
  }
  function t() { return i18n[lang] || i18n.zh; }
  function applyLocale() {
    const next = detectLang();
    const changed = next !== lang;
    lang = next;
    if (uiTheme) uiTheme.lang = lang;
    const s = t();
    if (!changed && $('.mode-toggle').getAttribute('aria-label') === s.annotate) return;
    $('.mode-toggle').setAttribute('aria-label', s.annotate);
    $('.list-open').setAttribute('aria-label', s.nav);
    card.setAttribute('aria-label', s.cardLabel);
    $('.close').setAttribute('aria-label', s.close);
    noteInput.setAttribute('aria-label', s.noteLabel);
    noteInput.setAttribute('placeholder', s.notePlaceholder);
    $('.delete').textContent = s.delete;
    $('.save').textContent = s.save;
    navigator.setAttribute('aria-label', s.nav);
    tooltip.textContent = s.annotate;
    for (const button of shadow.querySelectorAll('.swatch')) {
      const c = button.dataset.color;
      if (s.swatches[c]) button.setAttribute('aria-label', s.swatches[c]);
    }
    listSignature = '';
  }
  function parseRgb(value) {
    const s = String(value || '').trim();
    if (/^#[\da-f]{3}$/i.test(s)) return [1, 2, 3].map(i => parseInt(s[i] + s[i], 16));
    if (/^#[\da-f]{6}$/i.test(s)) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    const m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return null;
    const parts = m[1].trim().split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(n => !Number.isFinite(n))) return null;
    if (parts.length >= 4 && Number.isFinite(parts[3]) && parts[3] < 0.5) return null;
    return parts.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(n))));
  }
  function toHex(rgb) {
    return '#' + rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
  }
  function mixRgb(a, b, weightB) {
    const w = Math.max(0, Math.min(1, weightB));
    return [0, 1, 2].map(i => Math.round(a[i] * (1 - w) + b[i] * w));
  }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    return [h * 60, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function computeHighlights(accentRgb, dark) {
    let [h, s] = rgbToHsl(accentRgb || [232, 62, 118]);
    if (s < 0.08) { h = 340; s = 0.72; }
    const angDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
    const h1 = angDist(h, 46) < 22 ? (h < 46 ? 22 : 74) : h;
    const candPlus = (h1 + 58) % 360, candMinus = (h1 + 302) % 360;
    const h3 = angDist(candPlus, 50) >= angDist(candMinus, 50) ? candPlus : candMinus;
    const boost = hue => Math.max(0, Math.cos((hue - 250) * Math.PI / 180)) * 0.04;
    const s1 = Math.max(0.58, Math.min(0.78, s)), s3 = Math.max(0.52, Math.min(0.72, s * 0.92));
    return {
      pinkSwatch: toHex(hslToRgb(h1, s1, 0.74 + boost(h1))),
      yellowSwatch: '#efd477',
      greenSwatch: toHex(hslToRgb(h3, s3, 0.74 + boost(h3))),
      pinkHl: toHex(hslToRgb(h1, Math.max(0.65, Math.min(0.84, s)), (dark ? 0.60 : 0.64) + boost(h1))) + (dark ? '59' : '55'),
      yellowHl: '#efc74366',
      greenHl: toHex(hslToRgb(h3, Math.max(0.58, Math.min(0.76, s * 0.92)), (dark ? 0.58 : 0.62) + boost(h3))) + (dark ? '59' : '55'),
    };
  }
  window.__chatAnnotationsV1 = {summary, destroy};
  function restoreMenus() {
    for (const menu of hiddenMenus) menu.removeAttribute('data-chat-annotations-menu-hidden');
    hiddenMenus.clear();
  }
  function setAnnotationMode(enabled) {
    annotationMode = enabled; restoreMenus(); pending = null; editing = null; card.hidden = true; hideHoverPanels();
    $('.mode-toggle').setAttribute('aria-pressed', String(enabled));
  }

  function mathElement(parent) {
    return parent.closest('[data-math-source]') || parent.closest('.katex') || parent.closest('math');
  }
  function safeMath(element) {
    if (!element || element.localName !== 'math') return null;
    const tags = new Set('math mrow mi mn mo msup msub msubsup mfrac msqrt mroot mtable mtr mtd mtext mover munder munderover mpadded mspace menclose mmultiscripts mprescripts none mstyle semantics'.split(' '));
    const attributes = new Set('mathvariant display stretchy fence separator accent accentunder largeop movablelimits columnalign rowalign columnspacing rowspacing linethickness scriptlevel notation width height depth lspace voffset'.split(' '));
    let count = 0;
    function copy(node) {
      if (++count > 500) return null;
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.data);
      if (node.nodeType !== Node.ELEMENT_NODE || node.namespaceURI !== 'http://www.w3.org/1998/Math/MathML' || !tags.has(node.localName)) return null;
      const next = document.createElementNS('http://www.w3.org/1998/Math/MathML', node.localName);
      for (const attribute of node.attributes) if (attributes.has(attribute.name) && attribute.value.length <= 100 && !/url\s*\(|[<>]/i.test(attribute.value)) next.setAttribute(attribute.name, attribute.value);
      for (const child of node.childNodes) { const clean = copy(child); if (clean) next.append(clean); }
      return next;
    }
    const result = copy(element);
    if (!result || count > 500) return null;
    result.setAttribute('display', 'inline'); return result;
  }
  function unboxPreviewMath(math) {
    let unboxed = false;
    for (const box of [...math.querySelectorAll('menclose')]) {
      const notations = (box.getAttribute('notation') || '').split(/\s+/).filter(Boolean);
      if (!notations.includes('box') && !notations.includes('roundedbox')) continue;
      const remaining = notations.filter(value => value !== 'box' && value !== 'roundedbox');
      if (remaining.length) box.setAttribute('notation', remaining.join(' '));
      else box.replaceWith(...box.childNodes);
      unboxed = true;
    }
    if (unboxed) math.dataset.annotationUnboxed = 'true';
    return math;
  }
  function appendQuote(element, record) {
    const content = document.createElement('span'); content.className = 'quote-content';
    const more = document.createElement('span'); more.className = 'quote-ellipsis'; more.hidden = true; more.setAttribute('aria-hidden','true');
    element.append(content,more);
    let cursor = 0;
    for (const part of record.mathParts || []) {
      content.append(document.createTextNode(record.exact.slice(cursor, part.start)));
      let math = null;
      if (typeof part.markup === 'string' && part.markup.length <= 12000 && !part.markup.includes('<!')) {
        const parsed = new DOMParser().parseFromString(part.markup, 'application/xml');
        math = safeMath(parsed.documentElement);
        if (math) unboxPreviewMath(math);
      }
      content.append(math || document.createTextNode(record.exact.slice(part.start, part.end)));
      cursor = part.end;
    }
    content.append(document.createTextNode(record.exact.slice(cursor)));
    quoteLayouts.set(element,{source:[...content.childNodes].map(node=>node.cloneNode(true)),width:null,font:null});
  }
  function fitQuotes() {
    if (navigator.hidden) return;
    const measured = [...list.querySelectorAll('.item-quote,.item-note')].map(row => ({row,
      width:row.getBoundingClientRect().width,font:getComputedStyle(row).font+'|'+devicePixelRatio,layout:quoteLayouts.get(row)}));
    for (const {row,width,font,layout} of measured) {
      if (!layout || !width || (layout.width === width && layout.font === font)) continue;
      layout.width = width; layout.font = font;
      const content = row.querySelector('.quote-content'), more = row.querySelector('.quote-ellipsis');
      content.replaceChildren(...layout.source.map(node=>node.cloneNode(true)));
      more.hidden = true; more.textContent = ''; row.dataset.truncated = 'false';
      const range = document.createRange();
      const renderedWidth = () => {range.selectNodeContents(content);return range.getBoundingClientRect().width;};
      if (renderedWidth() <= width - .5) continue;
      // Keep ordinary compound formulas atomic; text-only MathML remains an excerpt.
      const groups = [], textGroup = (node,math = null) => ({node,math,text:node.data,
        ends:[...segmenter.segment(node.data)].map(part=>part.index+part.segment.length)});
      // Unboxed excerpts may contain several text runs and operators. Fit these
      // runs in order; keep fractions, scripts and other compound notation atomic.
      const previewRows = new Set(['math','mrow','mstyle','semantics','mtext']);
      function unboxedGroups(node) {
        if (node.nodeType === Node.TEXT_NODE) groups.push(textGroup(node));
        else if (previewRows.has(node.localName)) for (const child of node.childNodes) unboxedGroups(child);
        else groups.push({node,atomic:true,ends:[1]});
      }
      const textTags = new Set(['mrow','mstyle','semantics','menclose','mtext']);
      for (const child of content.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) groups.push(textGroup(child));
        else if (child.localName === 'math') {
          if (child.dataset.annotationUnboxed === 'true') { unboxedGroups(child); continue; }
          const texts = child.querySelectorAll('mtext'), text = texts[0];
          if (texts.length === 1 && text.textContent && [...child.querySelectorAll('*')].every(node=>textTags.has(node.localName)) &&
              [...text.childNodes].every(node=>node.nodeType===Node.TEXT_NODE)) {
            const node = document.createTextNode(text.textContent); text.replaceChildren(node); groups.push(textGroup(node,child));
          } else groups.push({node:child,atomic:true,ends:[1]});
        }
      }
      const total = groups.reduce((sum,group)=>sum+group.ends.length,0);
      const apply = count => {
        for (const group of groups) {
          const take = Math.min(count,group.ends.length); count -= take;
          if (group.atomic) group.node.style.display = take ? '' : 'none';
          else {
            group.node.data = take ? group.text.slice(0,group.ends[take-1]) : '';
            if (group.math) group.math.style.display = take ? '' : 'none';
          }
        }
      };
      more.hidden = false; more.textContent = '…'; row.dataset.truncated = 'true';
      const budget = Math.max(0,width-more.getBoundingClientRect().width-.5);
      let low = 0, high = total;
      while (low < high) {
        const mid = Math.ceil((low+high)/2); apply(mid);
        if (renderedWidth() <= budget) low = mid; else high = mid-1;
      }
      apply(low);
    }
  }
  function snapshot(message, includeMath = false) {
    const nodes = [], walker = document.createTreeWalker(message.element, NodeFilter.SHOW_TEXT);
    const seenMath = new Set(); let text = '', node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      const atom = includeMath && parent && mathElement(parent);
      if (atom) {
        if (seenMath.has(atom)) continue;
        seenMath.add(atom);
        if (!message.bodyRoots.some(body => body.contains(atom)) || !atom.checkVisibility({visibilityProperty:true})) continue;
        const source = (atom.closest('[data-math-source]')?.getAttribute('data-math-source') ||
          atom.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '').trim();
        if (!source || source.length > 10000) continue;
        const token = '\\(' + source + '\\)';
        nodes.push({node:atom, atomic:true, start:text.length, end:text.length + token.length});
        text += token; continue;
      }
      if (!parent || parent.closest(excluded) || !message.bodyRoots.some(body => body.contains(node))) continue;
      if (!parent.checkVisibility({visibilityProperty: true})) continue;
      nodes.push({node, start: text.length, end: text.length + node.length}); text += node.data;
    }
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return {nodes, text, textHash: text.length + ':' + (hash >>> 0).toString(16)};
  }
  function offsetAt(data, container, offset, edge = 'start') {
    const atom = data.nodes.find(item => item.atomic && item.node.contains(container));
    if (atom) return edge === 'end' ? atom.end : atom.start;
    const direct = data.nodes.find(item => !item.atomic && item.node === container);
    if (direct) return direct.start + offset;
    const point = document.createRange(); point.setStart(container, offset); point.collapse(true);
    for (const item of data.nodes) {
      const bounds = document.createRange();
      if (item.atomic) bounds.selectNode(item.node); else bounds.selectNodeContents(item.node);
      const before = bounds.cloneRange(); before.collapse(true);
      const after = bounds.cloneRange(); after.collapse(false);
      if (point.compareBoundaryPoints(Range.START_TO_START, before) <= 0) return item.start;
      if (point.compareBoundaryPoints(Range.START_TO_START, after) < 0) return edge === 'end' ? item.end : item.start;
    }
    return data.text.length;
  }
  function makeRange(data, start, end) {
    if (start < 0 || end <= start || end > data.text.length) return null;
    const first = data.nodes.find(item => item.end > start), last = data.nodes.find(item => item.end >= end && item.start < end);
    if (!first || !last) return null;
    const range = document.createRange();
    if (first.atomic) range.setStartBefore(first.node); else range.setStart(first.node, start - first.start);
    if (last.atomic) range.setEndAfter(last.node); else range.setEnd(last.node, end - last.start);
    return range;
  }
  function locate(record, data) {
    const {text} = data;
    const contextual = start => (!record.prefix || text.slice(Math.max(0, start - record.prefix.length), start) === record.prefix) &&
      (!record.suffix || text.slice(start + record.exact.length, start + record.exact.length + record.suffix.length) === record.suffix);
    if (record.textHash === data.textHash && text.slice(record.start, record.end) === record.exact) return record.start;
    const candidates = []; let index = text.indexOf(record.exact);
    while (index >= 0 && candidates.length < 200) { candidates.push(index); index = text.indexOf(record.exact, index + 1); }
    if (index >= 0) return -1;
    if (candidates.length === 1) return candidates[0];
    const unique = candidates.filter(contextual);
    return unique.length === 1 ? unique[0] : -1;
  }
  function storageKey() { return storagePrefix + encodeURIComponent(context); }
  function valid(record) {
    if (store) return store.valid(record);
    return record && typeof record.id === 'string' && typeof record.messageId === 'string' &&
      typeof record.exact === 'string' && record.exact.trim() && record.exact.length <= 20000 &&
      typeof record.prefix === 'string' && record.prefix.length <= 32 && typeof record.suffix === 'string' && record.suffix.length <= 32 &&
      typeof record.textHash === 'string' && record.textHash.length <= 40 &&
      Number.isInteger(record.start) && record.start >= 0 && record.end === record.start + record.exact.length &&
      colors.includes(record.color) && typeof record.note === 'string' && record.note.length <= 10000 &&
      (record.mathParts === undefined || (Array.isArray(record.mathParts) && record.mathParts.length <= 100 && record.mathParts.every((part,index,parts) =>
        Number.isInteger(part.start) && Number.isInteger(part.end) && part.start >= (index ? parts[index-1].end : 0) && part.end > part.start && part.end <= record.exact.length &&
        (part.markup === null || (typeof part.markup === 'string' && part.markup.length <= 12000)))));
  }
  function load(nextContext) {
    context = nextContext; saved = true;
    if (memory.has(context)) { ({records, saved} = memory.get(context)); return; }
    try {
      const raw = store ? null : localStorage.getItem(storageKey());
      const data = store ? store.read(context) : raw ? JSON.parse(raw) : {schema: 1, records: []};
      if (data.schema !== 1 || !Array.isArray(data.records) || data.records.some(record => !valid(record))) throw Error('Invalid annotations');
      records = data.records;
    } catch { records = []; saved = false; toast(t().readFailed); }
    memory.set(context, {records, saved});
  }
  function persist(next) {
    if (!saved) { toast(t().storageUnavailable); return false; }
    try { if(store)store.write(context,next);else localStorage.setItem(storageKey(), JSON.stringify({schema: 1, records: next})); }
    catch { toast(t().saveFailed); return false; }
    records = next; memory.set(context, {records, saved}); return true;
  }
  function toast(message) {
    $('.toast').textContent = message; $('.toast').hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('.toast').hidden = true; }, 3200);
  }
  function theme() {
    const docEl = typeof document !== 'undefined' ? document.documentElement : null;
    const docStyle = docEl ? getComputedStyle(docEl) : null;
    const pick = keys => {
      if (!docStyle?.getPropertyValue) return null;
      for (const k of keys) { const c = parseRgb(docStyle.getPropertyValue(k)); if (c) return c; }
      return null;
    };
    const surfaceRgb = pick(['--codex-base-surface', '--app-color-background-surface', '--color-surface']);
    const underRgb = pick(['--app-color-background-surface-under']) || (surfaceRgb && typeof document !== 'undefined' && document.body ? parseRgb(getComputedStyle(document.body).backgroundColor) : null);
    const accentRgb = pick(['--codex-base-accent', '--app-color-border-focus', '--app-color-text-accent', '--color-ring']);
    let rootRgb = null, dark = false;
    if (surface?.root) {
      const rootStyle = getComputedStyle(surface.root);
      host.style.fontFamily = rootStyle.fontFamily || 'inherit';
      host.style.setProperty('--annotation-text-font', rootStyle.fontFamily || 'inherit');
      host.style.fontWeight = rootStyle.fontWeight || 'inherit';
      const color = rootStyle.color.match(/\d+(?:\.\d+)?/g) || [];
      if (color.length >= 3) {
        rootRgb = [Number(color[0]), Number(color[1]), Number(color[2])];
        dark = rootRgb[0] + rootRgb[1] + rootRgb[2] > 480;
      }
    }
    const inkRgb = pick(['--codex-base-ink', '--app-color-text-foreground', '--color-text']) || rootRgb;
    if (!surface?.root) {
      if (surfaceRgb) dark = (surfaceRgb[0] + surfaceRgb[1] + surfaceRgb[2]) / 3 < 128;
      else if (inkRgb) dark = inkRgb[0] + inkRgb[1] + inkRgb[2] > 480;
      else dark = docEl?.getAttribute('data-theme') === 'dark' || !!docEl?.classList?.contains('dark');
    }
    let variables, underHex;
    if (surfaceRgb || accentRgb) {
      const sRgb = surfaceRgb || (dark ? [40, 38, 41] : [255, 253, 253]);
      const iRgb = inkRgb || (dark ? [241, 237, 242] : [41, 38, 43]);
      const aRgb = accentRgb || [232, 62, 118];
      const uRgb = underRgb || mixRgb(iRgb, sRgb, dark ? 0.90 : 0.94);
      underHex = toHex(uRgb);
      variables = {
        paper: toHex(sRgb),
        ink: toHex(iRgb),
        line: toHex(mixRgb(iRgb, sRgb, dark ? 0.78 : 0.85)),
        muted: toHex(mixRgb(iRgb, sRgb, 0.48)),
        soft: toHex(underRgb ? mixRgb(uRgb, sRgb, 0.25) : mixRgb(iRgb, sRgb, dark ? 0.90 : 0.94)),
        'annotation-accent': toHex(aRgb),
        'dock-hover': toHex(mixRgb(iRgb, sRgb, dark ? 0.84 : 0.89)),
        'dock-active': toHex(mixRgb(aRgb, sRgb, dark ? 0.76 : 0.86)),
        'scroll-thumb': toHex(mixRgb(iRgb, sRgb, dark ? 0.78 : 0.85)),
        'scroll-hover': toHex(mixRgb(iRgb, sRgb, dark ? 0.65 : 0.74)),
      };
    } else {
      underHex = dark ? '#1f1e20' : '#f6f2f2';
      variables = dark ? {paper:'#282629',ink:'#f1edf2',line:'#514c54',muted:'#aaa2af',soft:'#363138','annotation-accent':'#e83e76','dock-hover':'#444045','dock-active':'#58434d','scroll-thumb':'#514c54','scroll-hover':'#716a72'} :
        {paper:'#fffdfd',ink:'#29262b',line:'#dedade',muted:'#87818a',soft:'#f3f0f3','annotation-accent':'#e83e76','dock-hover':'#e9e5e8','dock-active':'#eadce2','scroll-thumb':'#dedbde','scroll-hover':'#c6c0c5'};
    }
    for (const [key, value] of Object.entries(variables)) host.style.setProperty('--' + key, value);
    const hl = computeHighlights(accentRgb || parseRgb(variables['annotation-accent']), dark);
    const nextCss = `::highlight(chat-annotations-pink){background-color:${hl.pinkHl}}::highlight(chat-annotations-yellow){background-color:${hl.yellowHl}}::highlight(chat-annotations-green){background-color:${hl.greenHl}}[data-chat-annotations-menu-hidden="v1"]{visibility:hidden!important}`;
    if (style.textContent !== nextCss) style.textContent = nextCss;
    const swatchColors = { pink: hl.pinkSwatch, yellow: hl.yellowSwatch, green: hl.greenSwatch };
    for (const button of shadow.querySelectorAll('.swatch')) {
      const c = swatchColors[button.dataset.color];
      if (c && button.style.backgroundColor !== c) button.style.backgroundColor = c;
    }
    uiTheme = { lang, dark: !!dark, bg: underHex, surface: variables.paper, ink: variables.ink, muted: variables.muted, border: variables.line, accent: variables['annotation-accent'] };
  }
  function refresh() {
    refreshTimer = 0; if (destroyed) return;
    applyLocale();
    let next;
    try { next = readSurface(); } catch { next = null; }
    if (!next) { theme(); navigationAbort?.abort(); setAnnotationMode(false); surface = null; matches = new Map(); historyReady.clear(); dock.hidden = true; for (const name of names) CSS.highlights.delete(name); return; }
    if (surface?.root !== next.root || context !== next.contextId) navigationAbort?.abort();
    surface = next;
    if (context !== surface.contextId || dirtyContexts.has(surface.contextId)) {
      const changing = context !== surface.contextId;
      memory.delete(surface.contextId);dirtyContexts.delete(surface.contextId);
      if(changing || store?.isDeleted(surface.contextId))setAnnotationMode(false);
      load(surface.contextId);
    }
    matches = new Map(); statuses = new Map(); historyReady = new Set();
    const ranges = new Map(colors.map(color => [color, []]));
    if (records.length) {
      const messageMap = new Map(surface.messages.map(message => [message.messageId, message]));
      const snapshots = new Map();
      const s = t();
      for (const record of records) {
        const message = messageMap.get(record.messageId);
        if (!message) {
          if (surface.navigation?.has(record.messageId)) historyReady.add(record.id);
          statuses.set(record.id, historyReady.has(record.id) ? s.inHistory : s.unloaded); continue;
        }
        let current = snapshots.get(record.messageId);
        if (!current) { current = {message, legacy:null, math:null}; snapshots.set(record.messageId, current); }
        const data = record.mathAnchors === true ? (current.math ||= snapshot(current.message, true)) : (current.legacy ||= snapshot(current.message));
        const start = locate(record, data);
        if (start < 0) { statuses.set(record.id, s.changed); continue; }
        const range = makeRange(data, start, start + record.exact.length);
        if (!range) { statuses.set(record.id, s.unannotatable); continue; }
        matches.set(record.id, range); ranges.get(record.color).push(range); statuses.set(record.id, s.located);
      }
    }
    for (const color of colors) CSS.highlights.set('chat-annotations-' + color, new Highlight(...ranges.get(color)));
    if(store?.isDeleted(context)) {setAnnotationMode(false);dock.hidden=true;saved=false;return;}
    theme(); position();
    if (!navigator.hidden) renderList();
  }
  function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(refresh, 100); }
  function storeChanged(event) {
    if (!store || destroyed) return;
    let affected = event.detail?.context;
    if (event.type === 'storage') {
      if (event.storageArea !== localStorage) return;
      if (event.key === null) {memory.clear();if(context)dirtyContexts.add(context);scheduleRefresh();return;}
      const prefix = ['chat-annotations:v1:','chat-annotations:deleted:v1:','chat-annotations:identity:v1:'].find(prefix=>event.key.startsWith(prefix));
      if (!prefix) return;
      try {affected=decodeURIComponent(event.key.slice(prefix.length));} catch {return;}
    }
    if (typeof affected !== 'string') return;
    memory.delete(affected);dirtyContexts.add(affected);
    const currentAffected = context && store.resolve(context)===store.resolve(affected);
    if(currentAffected){memory.delete(context);dirtyContexts.add(context);}
    if (currentAffected && store.isDeleted(context)) {
      navigationAbort?.abort();setAnnotationMode(false);records=[];matches.clear();historyReady.clear();saved=false;
      for(const name of names)CSS.highlights.delete(name);
    }
    scheduleRefresh();
  }
  function selected() {
    if (!annotationMode || !surface || !card.hidden) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) { pending = null; return; }
    const range = selection.getRangeAt(0);
    const message = surface.messages.find(item => item.element.contains(range.startContainer) && item.element.contains(range.endContainer));
    if (!message) { pending = null; return; }
    const data = snapshot(message, true);
    if ([...message.element.querySelectorAll(mathSelector + ',svg')].some(element => range.intersectsNode(element) &&
      !data.nodes.some(item => item.atomic && (item.node === element || item.node.contains(element) || element.contains(item.node))))) {
      pending = null; return;
    }
    const start = offsetAt(data, range.startContainer, range.startOffset), end = offsetAt(data, range.endContainer, range.endOffset, 'end');
    const exact = data.text.slice(start, end);
    if (!exact.trim() || exact.length > 20000 || !makeRange(data, start, end)) { pending = null; return; }
    const mathNodes = data.nodes.filter(item => item.atomic && item.start >= start && item.end <= end);
    if (mathNodes.length > 100) { pending = null; return; }
    // Capture preview markup only for selected formulas, never for every formula on a refresh.
    const mathParts = mathNodes.map(item => {
      const math = safeMath(item.node.matches('math') ? item.node : item.node.querySelector('math'));
      const markup = math ? new XMLSerializer().serializeToString(math) : null;
      return {start:item.start - start,end:item.end - start,markup:markup?.length <= 12000 ? markup : null};
    });
    pending = {messageId: message.messageId, start, end, exact, textHash: data.textHash, mathAnchors:true, mathParts,
      prefix: data.text.slice(Math.max(0, start - 32), start), suffix: data.text.slice(end, end + 32), range: makeRange(data, start, end)};
    position();
  }
  function nativeMenu(rect) {
    const labels = /^(添加到对话|更多详情|在侧边聊天中提问|向\s*ChatGPT\s*提问|Add to (?:chat|conversation)|More details?|Ask ChatGPT|Ask in (?:a )?side chat)$/i;
    for (const button of document.querySelectorAll('button,[role="button"]')) {
      if (!labels.test(button.textContent.trim()) || !button.checkVisibility({visibilityProperty:true})) continue;
      let found = button;
      for (let parent = button.parentElement, count = 0; parent && count < 4; parent = parent.parentElement, count++) {
        const box = parent.getBoundingClientRect();
        if (box.width > 0 && box.width < 720 && box.height >= 20 && box.height <= 70) found = parent;
        else if (box.height > 70) break;
      }
      const box = found.getBoundingClientRect();
      if (box.bottom > 0 && box.top < innerHeight && box.right >= rect.left - 80 && box.left <= rect.right + 80 &&
        Math.abs((box.top + box.bottom) / 2 - (rect.top + rect.bottom) / 2) < rect.height / 2 + 130) return found;
    }
    return null;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(value, Math.max(min, max))); }
  function place(element, x, y) {
    const box = element.getBoundingClientRect();
    element.style.left = clamp(x, 10, innerWidth - box.width - 10) + 'px';
    element.style.top = clamp(y, 10, innerHeight - box.height - 10) + 'px';
  }
  function position() {
    if (destroyed || !surface) return;
    const bounds = surface.root.getBoundingClientRect();
    if (!bounds.width || !bounds.height || bounds.top >= innerHeight || bounds.bottom <= 0) { dock.hidden = true; hideHoverPanels(); return; }
    dock.style.visibility = 'hidden'; dock.hidden = false;
    place(dock, bounds.right - dock.getBoundingClientRect().width - 14, bounds.top + 10);
    dock.style.visibility = 'visible';
    if (pending && !pending.range.startContainer.isConnected) pending = null;
    if (pending) {
      const rect = pending.range.getBoundingClientRect();
      if (!rect.width || rect.bottom < bounds.top || rect.top > bounds.bottom) pending = null;
      else if (annotationMode) {
        const menuElement = nativeMenu(rect);
        if (menuElement) { hiddenMenus.add(menuElement); menuElement.setAttribute('data-chat-annotations-menu-hidden', 'v1'); }
      }
    }
    if (!card.hidden && lastRect) place(card, lastRect.left, lastRect.bottom + 7);
    if (!navigator.hidden) {
      fitQuotes();
      const rect = $('.list-open').getBoundingClientRect();
      place(navigator, rect.right - navigator.getBoundingClientRect().width, rect.bottom + 7);
    }
    if (!preview.hidden && previewId) {
      const hit = hoverPoint && hitAt(hoverPoint);
      if (!matches.has(previewId) || (!preview.matches(':hover') && hit?.record.id !== previewId)) hidePreview();
      else {
        if (hit?.record.id === previewId) previewRect = hit.rect;
        if (previewRect) {
          const height = preview.getBoundingClientRect().height;
          const y = previewRect.bottom + 7 + height <= innerHeight - 10 ? previewRect.bottom + 7 : previewRect.top - height - 7;
          place(preview, previewRect.left, y);
        }
      }
    }
    if (!tooltip.hidden) { const rect = $('.mode-toggle').getBoundingClientRect(); place(tooltip, rect.left + (rect.width - tooltip.offsetWidth) / 2, rect.bottom + 7); }
  }
  function hideNavigation() { navigator.hidden = true; $('.list-open').setAttribute('aria-expanded', 'false'); }
  function hidePreview() { preview.hidden = true; previewId = null; previewRect = null; }
  function hideHoverPanels() { clearTimeout(hoverTimer); hideNavigation(); hidePreview(); tooltip.hidden = true; }
  function postponeHoverClose() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (navigator.matches(':hover') || $('.list-open').matches(':hover') || navigator.contains(shadow.activeElement)) return;
      if (preview.matches(':hover') || (previewId && hoveredId === previewId)) return;
      hideNavigation(); hidePreview();
    }, 180);
  }
  function showNavigation() {
    if (!card.hidden) return;
    clearTimeout(hoverTimer); hidePreview(); tooltip.hidden = true; navigator.hidden = false;
    $('.list-open').setAttribute('aria-expanded', 'true'); renderList(); position();
  }
  function showPreview(record, rect) {
    if (!card.hidden || !record?.note.trim()) return;
    clearTimeout(hoverTimer); hideNavigation(); tooltip.hidden = true;
    previewId = record.id; previewRect = rect; preview.textContent = record.note; preview.hidden = false; position();
  }
  function hitAt(point) {
    if (!surface || !point) return null;
    const bounds = surface.root.getBoundingClientRect();
    if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return null;
    const target = document.elementFromPoint(point.x, point.y);
    if (!target || !surface.root.contains(target) || target.closest('button,input,textarea,[contenteditable="true"]')) return null;
    for (const record of [...records].reverse()) {
      const range = matches.get(record.id);
      if (!range?.endContainer.isConnected) continue;
      const rect = [...range.getClientRects()].find(rect => rect.width && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
      if (rect) return {record, rect};
    }
    return null;
  }
  function moved(event) {
    if (event.pointerType === 'touch') return;
    if (event.composedPath().includes(host)) {
      cancelAnimationFrame(hoverFrame); hoverFrame = 0;
      hoveredId = null;
      if (event.composedPath().includes(preview)) clearTimeout(hoverTimer);
      else postponeHoverClose();
      return;
    }
    hoverPoint = {x:event.clientX, y:event.clientY};
    if (event.buttons || !card.hidden) { cancelAnimationFrame(hoverFrame); hoverFrame = 0; hoveredId = null; hidePreview(); return; }
    if (!hoverFrame) hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const hit = hitAt(hoverPoint); hoveredId = hit?.record.id || null;
      if (hit?.record.note.trim()) showPreview(hit.record, hit.rect);
      else postponeHoverClose();
    });
  }
  function pointerLeft(event) {
    if (event.relatedTarget) return;
    hoverPoint = null; hoveredId = null; postponeHoverClose();
  }
  function clicked(event) {
    if (event.composedPath().includes(host) || event.button !== 0 || !window.getSelection()?.isCollapsed ||
      !pressPoint || Math.hypot(event.clientX-pressPoint.x, event.clientY-pressPoint.y) > 4) return;
    const hit = hitAt({x:event.clientX, y:event.clientY});
    if (hit) showEditor(hit.record, hit.rect);
  }
  function scrolled(event) {
    if (!event.composedPath().includes(host)) { hoveredId = null; hoverPoint = null; hidePreview(); }
    schedulePosition();
  }
  function schedulePosition() { if (!frame) frame = requestAnimationFrame(() => {frame = 0; position();}); }
  function choose(color) {
    chosenColor = color;
    for (const button of shadow.querySelectorAll('.swatch')) button.setAttribute('aria-pressed', String(button.dataset.color === color));
  }
  function showEditor(record, rect) {
    hideHoverPanels(); editing = record; lastRect = rect; card.hidden = false;
    noteInput.value = record.note || ''; choose(record.color || 'pink');
    $('.delete').hidden = !records.some(item => item.id === record.id);
    position();
  }
  function closeCard() { card.hidden = true; editing = null; selected(); }
  function scrollToAnnotation(record) {
    const range = matches.get(record.id);
    if (!range || !surface) return false;
    const rect = range.getBoundingClientRect(), rootRect = surface.root.getBoundingClientRect();
    surface.root.scrollTop += rect.top - rootRect.top - surface.root.clientHeight / 3;
    hideNavigation(); schedulePosition(); return true;
  }
  async function jumpAnnotation(record) {
    navigationAbort?.abort();
    refresh();
    if (scrollToAnnotation(record) || !historyReady.has(record.id)) return;
    const expectedContext = context, expectedRoot = surface.root, navigation = surface.navigation;
    const controller = new AbortController(); navigationAbort = controller;
    const deadline = setTimeout(() => controller.abort(), 15000);
    const stillCurrent = () => !destroyed && context === expectedContext && surface?.root === expectedRoot;
    hideNavigation();
    try {
      if (!await navigation.jump(record.messageId, controller.signal)) return;
      while (stillCurrent() && !controller.signal.aborted) {
        refresh();
        if (!stillCurrent()) return;
        if (scrollToAnnotation(record)) return;
        // Once the answer exists but its text does not match, never attach to another quote.
        if (surface.messages.some(message => message.messageId === record.messageId)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (stillCurrent()) toast(t().locateFailed);
    } catch {
      if (stillCurrent() && navigationAbort === controller) toast(t().historyFailed);
    } finally {
      clearTimeout(deadline);
      if (navigationAbort === controller) navigationAbort = null;
    }
  }
  function renderList() {
    const signature = JSON.stringify([lang, ...records.map(record => [record.id, record.exact, record.note, matches.has(record.id), historyReady.has(record.id), statuses.get(record.id)])]);
    if (signature === listSignature && list.childNodes.length) return;
    listSignature = signature;
    list.replaceChildren();
    const s = t();
    if (!records.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = s.empty; list.append(empty); return; }
    for (const record of [...records].reverse()) {
      const button = document.createElement('button'); button.className = 'item';
      const quote = document.createElement('span'); quote.className = 'item-quote'; appendQuote(quote, record);
      const note = document.createElement('span'); note.className = 'item-note'; appendQuote(note,{exact:record.note});
      const located = matches.has(record.id) || historyReady.has(record.id); button.dataset.unresolved = String(!located); button.disabled = !located;
      if (!located) button.setAttribute('aria-label', record.exact + s.sep + (statuses.get(record.id) || s.unloaded));
      button.append(quote); if (record.note.trim()) button.append(note);
      button.onclick = () => { void jumpAnnotation(record); }; list.append(button);
    }
    fitQuotes();
  }
  for (const color of colors) {
    const button = document.createElement('button'); button.className = 'swatch'; button.dataset.color = color;
    button.style.backgroundColor = {yellow:'#efd477',green:'#89d7b0',pink:'#eda6c6'}[color];
    button.setAttribute('aria-label', t().swatches[color]);
    button.onclick = () => choose(color); $('.palette').append(button);
  }
  function newAnnotation(rect) {
    if (!pending) return;
    const {range, ...anchor} = pending;
    showEditor({...anchor, id: crypto.randomUUID(), color: 'pink', note: '', createdAt: new Date().toISOString()}, rect);
  }
  $('.mode-toggle').onclick = () => {
    setAnnotationMode(!annotationMode);
  };
  $('.mode-toggle').onpointerenter = $('.mode-toggle').onfocus = () => {
    tooltip.hidden = false; position();
  };
  $('.mode-toggle').onpointerleave = $('.mode-toggle').onblur = () => { tooltip.hidden = true; };
  $('.list-open').onpointerenter = $('.list-open').onfocus = $('.list-open').onclick = showNavigation;
  $('.list-open').onpointerleave = $('.list-open').onblur = postponeHoverClose;
  navigator.onpointerenter = preview.onpointerenter = () => clearTimeout(hoverTimer);
  navigator.onpointerleave = navigator.onfocusout = preview.onpointerleave = postponeHoverClose;
  $('.close').onclick = closeCard;
  $('.save').onclick = () => {
    if (!editing || context !== readSurface()?.contextId) { refresh(); return; }
    const record = {...editing, note: noteInput.value, color: chosenColor};
    const exists = records.some(item => item.id === record.id);
    const next = exists ? records.map(item => item.id === record.id ? record : item) : [...records, record];
    if (!persist(next)) return;
    card.hidden = true; editing = null; pending = null; refresh();
  };
  $('.delete').onclick = () => {
    if (editing && context === readSurface()?.contextId && persist(records.filter(record => record.id !== editing.id))) { card.hidden = true; editing = null; refresh(); }
  };
  function outside(event) {
    pressPoint = {x:event.clientX, y:event.clientY};
    if (event.composedPath().includes(host)) return;
    if (!card.hidden) { card.hidden = true; editing = null; }
    hideHoverPanels();
  }
  function keydown(event) {
    if (event.key !== 'Escape') return;
    card.hidden = true; pending = null; editing = null; hideHoverPanels();
  }
  function selectionFinished(event) {
    if (!annotationMode || event.composedPath().includes(host) || (event.type === 'keyup' && event.key !== 'Shift')) return;
    if (event.target instanceof Element && event.target.closest('button,input,textarea,[role="button"],[contenteditable="true"]')) return;
    selected();
    if (pending && card.hidden) newAnnotation(pending.range.getBoundingClientRect());
  }
  observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.target !== host && !host.contains(mutation.target) && mutation.target !== style)) {
      scheduleRefresh(); schedulePosition();
    }
  });
  observer.observe(document.body, {childList:true, subtree:true, characterData:true,
    attributes:true, attributeFilter:['data-chatgpt-selection-conversation-id','data-chatgpt-selection-message-id','data-response-annotation-conversation','data-response-annotation-target']});
  document.addEventListener('selectionchange', selected);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('pointermove', moved);
  document.addEventListener('pointerout', pointerLeft);
  document.addEventListener('click', clicked, true);
  document.addEventListener('keydown', keydown);
  document.addEventListener('pointerup', selectionFinished);
  document.addEventListener('keyup', selectionFinished);
  document.addEventListener('scroll', scrolled, true);
  window.addEventListener('resize', scheduleRefresh);
  window.addEventListener('chat-annotations-store-change',storeChanged);
  window.addEventListener('storage',storeChanged);
  function visibilityChanged() { if (!document.hidden) scheduleRefresh(); }
  document.addEventListener('visibilitychange', visibilityChanged);
  timer = setInterval(() => { if (!document.hidden) refresh(); }, 1500);
  function summary() { return {installed:ready && !destroyed, version, messages:surface?.messages.length || 0, annotations:records.length,
    located:matches.size, historyNavigable:historyReady.size, unresolved:records.length - matches.size, storageAvailable:saved,
    mode:surface?.contextId.split(':')[0] || null, annotationMode, uiTheme}; }
  function destroy() {
    navigationAbort?.abort();
    destroyed = true; observer?.disconnect(); clearInterval(timer); clearTimeout(refreshTimer); clearTimeout(toastTimer); clearTimeout(hoverTimer); cancelAnimationFrame(frame); cancelAnimationFrame(hoverFrame);
    document.removeEventListener('selectionchange', selected); document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('pointermove', moved); document.removeEventListener('pointerout', pointerLeft); document.removeEventListener('click', clicked, true);
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('pointerup', selectionFinished); document.removeEventListener('keyup', selectionFinished); restoreMenus();
    document.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', scheduleRefresh);
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('chat-annotations-store-change',storeChanged);window.removeEventListener('storage',storeChanged);
    for (const name of names) CSS.highlights.delete(name);
    style.remove(); host.remove();
    if (window.__chatAnnotationsV1?.destroy === destroy) {
      for (const element of document.querySelectorAll('#chat-annotations-v1,style[data-chat-annotations-style="v1"]')) element.remove();
      delete window.__chatAnnotationsV1;
    }
  }
  ready = true; refresh(); selected();
  return summary();
}

if (typeof module !== 'undefined') module.exports = {installChatAnnotations};
