'use strict';

function installAnnotationStore() {
  if (window.__chatAnnotationStoreV1?.version === 2) return window.__chatAnnotationStoreV1;
  const prefix = 'chat-annotations:v1:', deletedPrefix = 'chat-annotations:deleted:v1:', aliasPrefix = 'chat-annotations:identity:v1:';
  const contextValid = context => typeof context === 'string' && /^(chatgpt|codex):[^\s]{1,256}$/.test(context);
  function resolve(context) {
    if (!contextValid(context)) throw Error('Invalid annotation context');
    const visited = new Set();
    for (let i=0;i<32;i++) {
      if (visited.has(context)) throw Error('Cyclic annotation identity');
      visited.add(context);
      const next=localStorage.getItem(aliasPrefix+encodeURIComponent(context));
      if (next===null) return context;
      if (!contextValid(next)||next.split(':')[0]!==context.split(':')[0]) throw Error('Invalid annotation identity');
      context=next;
    }
    throw Error('Too many annotation identities');
  }
  const key = context => prefix + encodeURIComponent(resolve(context));
  const deletedKey = context => deletedPrefix + encodeURIComponent(resolve(context));
  function valid(record) {
    return record && typeof record.id === 'string' && typeof record.messageId === 'string' &&
      typeof record.exact === 'string' && record.exact.trim() && record.exact.length <= 20000 &&
      typeof record.prefix === 'string' && record.prefix.length <= 32 && typeof record.suffix === 'string' && record.suffix.length <= 32 &&
      typeof record.textHash === 'string' && record.textHash.length <= 40 &&
      Number.isInteger(record.start) && record.start >= 0 && record.end === record.start + record.exact.length &&
      ['yellow','green','pink'].includes(record.color) && typeof record.note === 'string' && record.note.length <= 10000 &&
      (record.mathParts === undefined || (Array.isArray(record.mathParts) && record.mathParts.length <= 100 && record.mathParts.every((part,index,parts) =>
        Number.isInteger(part.start) && Number.isInteger(part.end) && part.start >= (index ? parts[index-1].end : 0) && part.end > part.start && part.end <= record.exact.length &&
        (part.markup === null || (typeof part.markup === 'string' && part.markup.length <= 12000)))));
  }
  function isDeleted(context) { return localStorage.getItem(deletedKey(context)) !== null; }
  function read(context) {
    if (isDeleted(context)) return {schema:1,records:[]};
    const raw = localStorage.getItem(key(context)), data = raw === null ? {schema:1,records:[]} : JSON.parse(raw);
    if (data.schema !== 1 || !Array.isArray(data.records) || !data.records.every(valid)) throw Error('Invalid annotation data');
    return data;
  }
  function changed(context) { window.dispatchEvent(new CustomEvent('chat-annotations-store-change',{detail:{context}})); }
  function commit(context, data) {
    if (isDeleted(context)) throw Error('Conversation deleted');
    localStorage.setItem(key(context),JSON.stringify(data)); changed(resolve(context));
  }
  function write(context, records) {
    if (!Array.isArray(records) || !records.every(valid)) throw Error('Invalid annotation records');
    const data = read(context); commit(context,{...data,records});
  }
  function snapshot(context) { return JSON.parse(JSON.stringify(read(context).records)); }
  function inherit(source, target, sourceRecords, messageIds) {
    if (!contextValid(source) || !contextValid(target) || source === target || source.split(':')[0] !== target.split(':')[0] ||
        !Array.isArray(sourceRecords) || !sourceRecords.every(valid) || !(messageIds instanceof Set)) throw Error('Invalid annotation inheritance');
    if (resolve(source)===resolve(target)||isDeleted(target)) return 0;
    const data = read(target);
    if (data.inherited === true) return 0; // A later reload must not restore an intentionally deleted copy.
    const copies = sourceRecords.filter(record => messageIds.has(record.messageId)).map(record => ({...JSON.parse(JSON.stringify(record)),id:crypto.randomUUID()}));
    commit(target,{...data,records:[...data.records,...copies],inherited:true});
    return copies.length;
  }
  const marksPrefix = 'question-timeline:bookmarks:v1:', anchorsPrefix = 'question-timeline:bookmark-anchors:v1:';
  function bookmarkData(context) {
    context=resolve(context);
    if(isDeleted(context))return {records:[],inherited:false};
    const keys=JSON.parse(localStorage.getItem(marksPrefix+context)||'[]');
    const data=JSON.parse(localStorage.getItem(anchorsPrefix+context)||'{"schema":1,"records":[]}');
    if(!Array.isArray(keys)||!keys.every(key=>typeof key==='string')||data.schema!==1||!Array.isArray(data.records)||
       !data.records.every(record=>typeof record.key==='string'&&Array.isArray(record.messageIds)&&record.messageIds.every(id=>typeof id==='string')))throw Error('Invalid bookmark data');
    const anchors=new Map(data.records.map(record=>[record.key,record.messageIds]));
    return {inherited:data.inherited===true,records:[...new Set(keys)].map(key=>({key,messageIds:[...(anchors.get(key)||[])]}))};
  }
  function saveBookmarks(context, records, inherited=bookmarkData(context).inherited) {
    context=resolve(context);
    if(isDeleted(context))throw Error('Conversation deleted');
    const keys=records.map(record=>record.key);
    localStorage.setItem(anchorsPrefix+context,JSON.stringify({schema:1,inherited,records}));
    localStorage.setItem(marksPrefix+context,JSON.stringify(keys));
    window.__questionTimelineBookmarkCache?.delete(context);
    window.dispatchEvent(new CustomEvent('chat-timeline-bookmarks-change',{detail:{context}}));
  }
  function syncBookmarks(context, entries) {
    const data=bookmarkData(context), visible=new Set();
    const records=data.records.map(record=>{
      const matches=entries.filter(entry=>record.messageIds.length ? entry.userMessageIds?.some(id=>record.messageIds.includes(id)) : entry.key===record.key);
      if(matches.length!==1){if(!record.messageIds.length)visible.add(record.key);return record;}
      visible.add(matches[0].key);
      return {key:matches[0].key,messageIds:[...new Set(matches[0].userMessageIds||record.messageIds)]};
    });
    if(JSON.stringify(records)!==JSON.stringify(data.records))saveBookmarks(context,records,data.inherited);
    return visible;
  }
  function writeBookmarks(context, keys, entries) {
    const data=bookmarkData(context), old=new Map(data.records.map(record=>[record.key,record]));
    const records=[...keys].map(key=>({key,messageIds:[...new Set(entries.find(entry=>entry.key===key)?.userMessageIds||old.get(key)?.messageIds||[])]}));
    saveBookmarks(context,records,data.inherited);
  }
  function toggleBookmark(context, entry) {
    const data=bookmarkData(context), index=data.records.findIndex(record=>record.key===entry.key&&(!record.messageIds.length||entry.userMessageIds?.some(id=>record.messageIds.includes(id))));
    if(index>=0)data.records.splice(index,1);
    else data.records.push({key:entry.key,messageIds:[...new Set(entry.userMessageIds||[])]});
    saveBookmarks(context,data.records,data.inherited);
  }
  function snapshotBookmarks(context) {return bookmarkData(context).records;}
  function inheritBookmarks(source,target,records,messageIds) {
    if(!contextValid(source)||!contextValid(target)||source.split(':')[0]!==target.split(':')[0]||!(messageIds instanceof Set)||!Array.isArray(records))throw Error('Invalid bookmark inheritance');
    if(resolve(source)===resolve(target)||isDeleted(target))return 0;
    const data=bookmarkData(target);
    if(data.inherited)return 0;
    const existing=new Set(data.records.map(record=>record.key));
    const copies=records.filter(record=>!existing.has(record.key)&&record.messageIds.some(id=>messageIds.has(id)))
      .map(record=>({key:record.key,messageIds:record.messageIds.filter(id=>messageIds.has(id))}));
    saveBookmarks(target,[...data.records,...copies],true);
    return copies.length;
  }
  function rekey(from, to) {
    // A native draft -> saved ID transition is the same conversation, not a branch.
    if (!contextValid(from)||!contextValid(to)||from.split(':')[0]!==to.split(':')[0]) throw Error('Invalid annotation identity');
    from=resolve(from); to=resolve(to);
    if (from===to) return;
    if (isDeleted(from)||isDeleted(to)) { remove(from); remove(to); return; }
    const old=read(from), target=read(to), existing=new Set(target.records.map(record=>record.id));
    commit(to,{...old,...target,records:[...target.records,...old.records.filter(record=>!existing.has(record.id))],
      ...(old.inherited||target.inherited?{inherited:true}:{})});
    const oldMarks=bookmarkData(from), targetMarks=bookmarkData(to), marked=new Set(targetMarks.records.map(record=>record.key));
    saveBookmarks(to,[...targetMarks.records,...oldMarks.records.filter(record=>!marked.has(record.key))],oldMarks.inherited||targetMarks.inherited);
    localStorage.removeItem(marksPrefix+from);localStorage.removeItem(anchorsPrefix+from);
    window.__questionTimelineBookmarkCache?.delete(from);
    localStorage.setItem(aliasPrefix+encodeURIComponent(from),to);
    localStorage.removeItem(prefix+encodeURIComponent(from));changed(from);changed(to);
  }
  function remove(context) {
    context=resolve(context);
    const clear=()=>{localStorage.removeItem(key(context));localStorage.removeItem(marksPrefix+context);localStorage.removeItem(anchorsPrefix+context);window.__questionTimelineBookmarkCache?.delete(context);};
    // Write the tombstone first: delayed saves and inheritance cannot resurrect a deleted conversation.
    try {localStorage.setItem(deletedKey(context),String(Date.now()));}
    catch {clear();localStorage.setItem(deletedKey(context),String(Date.now()));}
    clear(); changed(context);window.dispatchEvent(new CustomEvent('chat-timeline-bookmarks-change',{detail:{context}}));
  }
  const store = {version:2,bookmarkData,syncBookmarks,writeBookmarks,toggleBookmark,snapshotBookmarks,inheritBookmarks,valid,read,write,snapshot,inherit,rekey,resolve,remove,isDeleted,key,deletedKey};
  window.__chatAnnotationStoreV1 = store; return store;
}
if (typeof module !== 'undefined') module.exports = {installAnnotationStore};
