'use strict';

// DOM extraction with optional page-local Timeline navigation. No history requests or model calls.
function readAnnotationSurface() {
  const roots = [...document.querySelectorAll('.thread-scroll-container')].filter(element => {
    const rect = element.getBoundingClientRect();
    return element.checkVisibility({visibilityProperty: true}) && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  });
  if (roots.length !== 1) return null;
  const root = roots[0], messages = [], contexts = new Set();
  const selector = '[data-response-annotation-target][data-response-annotation-conversation], ' +
    '[data-chatgpt-selection-message-id][data-chatgpt-selection-conversation-id]';
  for (const element of root.querySelectorAll(selector)) {
    if (!element.checkVisibility({visibilityProperty: true})) continue;
    const bodyRoots = [...element.querySelectorAll('[data-selected-text-overlay-target][data-markdown-text-style]')];
    if (!bodyRoots.length) continue;
    const codex = element.hasAttribute('data-response-annotation-target');
    const conversation = element.getAttribute(codex ? 'data-response-annotation-conversation' : 'data-chatgpt-selection-conversation-id');
    const messageId = element.getAttribute(codex ? 'data-response-annotation-target' : 'data-chatgpt-selection-message-id');
    if (!conversation || !messageId) continue;
    const contextId = (codex ? 'codex:' : 'chatgpt:') + conversation;
    contexts.add(contextId);
    messages.push({contextId, messageId, element, bodyRoots,
      turnKey: element.closest('[data-turn-key]')?.getAttribute('data-turn-key') || null});
  }
  if (contexts.size !== 1) return null;
  const contextId = [...contexts][0];
  let navigation = null;
  try { navigation = window.__questionTimelinePrototype?.annotationNavigation?.(contextId) || null; } catch { /* DOM-only fallback remains available. */ }
  return {root, contextId, messages, navigation};
}

if (typeof module !== 'undefined') module.exports = {readAnnotationSurface};
