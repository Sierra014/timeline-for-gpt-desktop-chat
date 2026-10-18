'use strict';

// Observe completed native actions. Never issue a branch, delete, history or model request.
async function installAnnotationLifecycle(installStore, options = {}) {
  if (options.ready && !options.ready()) return {installed:false,waitingForApplication:true};
  const previous = window.__chatAnnotationLifecycleV1;
  if (previous?.version === 3) {previous.refresh();return previous.summary();}
  previous?.destroy();
  const store = installStore(), restores = [], pending = new Map();
  let destroyed = false, bookmarkCopies = 0, copies = 0, deletions = 0, failures = 0, clients = 0, buses = 0, branchers = 0, identities = 0;
  let identityAtom = options.identityAtom;
  const observedScopes = new WeakSet(), observedBranchers = new WeakSet(), modules = [], branchAtoms = [], draftWatchers = new Map();
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\s/.test(value);
  function guarded(action) { try { return action(); } catch { failures++; return null; } }
  function chatPath(conversation, boundary, targetId = conversation?.conversation_id ?? conversation?.id) {
    if (!conversation || !id(targetId) || !id(conversation.current_node) ||
        !conversation.mapping || typeof conversation.mapping !== 'object') return null;
    const users = new Set(), messages = new Set(), visited = new Set(); let nodeId = conversation.current_node;
    if (boundary) {
      const candidates=Object.keys(conversation.mapping).filter(key=>key===boundary||conversation.mapping[key]?.message?.id===boundary);
      if(candidates.length!==1)return null;
      nodeId=candidates[0];
    }
    // Only the active ancestral path; mapping can also contain discarded response variants.
    while (nodeId != null) {
      if (!id(nodeId) || visited.has(nodeId) || visited.size >= 200000) return null;
      visited.add(nodeId);
      const node = conversation.mapping[nodeId];
      if (!node || typeof node !== 'object' || !Object.hasOwn(node,'parent')) return null;
      if (node.message?.author?.role === 'assistant' && id(node.message.id)) messages.add(node.message.id);
      if (node.message?.author?.role === 'user' && id(node.message.id)) users.add(node.message.id);
      nodeId = node.parent;
      if (nodeId !== null && nodeId !== undefined && !id(nodeId)) return null;
    }
    return {context:'chatgpt:'+targetId,messages,users};
  }
  function snapshotBookmarks(context) {
    window.__questionTimelinePrototype?.syncBookmarks?.(context);
    return store.snapshotBookmarks(context);
  }
  function copyChat(request, response) {
    if(!id(response?.clientThreadId)){failures++;return;}
    const path = chatPath(response?.conversation,request.boundary,response?.clientThreadId);
    if (!path) { failures++; return; }
    if(request.records)guarded(()=>{copies += store.inherit(request.context,path.context,request.records,path.messages);});
    if(request.bookmarks)guarded(()=>{bookmarkCopies += store.inheritBookmarks(request.context,path.context,request.bookmarks,path.users);});
  }
  function watchIdentity(scope, draft) {
    if (!identityAtom || !scope || typeof scope.watch!=='function' || !id(draft) || !draft.startsWith('local-chatgpt:') || draftWatchers.has(draft)) return;
    let unsubscribe,completed=false;
    const stop=()=>{unsubscribe?.();draftWatchers.delete(draft);};
    draftWatchers.set(draft,stop);
    try {
      unsubscribe=scope.watch(current=>{
        if(destroyed||completed)return;
        guarded(()=>{
          const saved=current.get(identityAtom,draft);
          if(id(saved)&&!saved.startsWith('local-chatgpt:')) {
            store.rekey('chatgpt:'+draft,'chatgpt:'+saved);completed=true;queueMicrotask(stop);
          }
        });
      });
      if(typeof unsubscribe!=='function')throw Error('Native identity subscription unavailable');
      restores.push(stop);
    }catch(error){stop();throw error;}
  }
  function observeScope(scope) {
    if(!identityAtom||!scope||typeof scope.watch!=='function'||observedScopes.has(scope))return;
    observedScopes.add(scope);identities++;
    // Also resume identity tracking for drafts annotated before this renderer was refreshed.
    const prefixes=['chat-annotations:v1:','question-timeline:bookmarks:v1:'];
    const keys=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index));
    for(const key of keys) {
      const prefix=prefixes.find(prefix=>key?.startsWith(prefix));if(!prefix)continue;
      const context=prefix.startsWith('question-')?key.slice(prefix.length):decodeURIComponent(key.slice(prefix.length));
      if(context.startsWith('chatgpt:local-chatgpt:'))guarded(()=>watchIdentity(scope,context.slice(8)));
    }
  }
  function observeBrancher(prototype) {
    if (!prototype || typeof prototype.branch!=='function' || observedBranchers.has(prototype)) return;
    const own=Object.getOwnPropertyDescriptor(prototype,'branch'),original=prototype.branch;
    function wrapped(params) {
      let request=null;
      guarded(()=>{
        observeScope(this.scope);
        if(id(params?.conversationId)&&id(params?.messageId)) {
          const context='chatgpt:'+params.conversationId;
          request={context,boundary:params.messageId};
          request.records=guarded(()=>store.snapshot(context));
          request.bookmarks=guarded(()=>snapshotBookmarks(context));
        }
      });
      const result=Reflect.apply(original,this,arguments);
      if(!request || !result || typeof result.then!=='function')return result;
      return result.then(response=>{if(!destroyed)guarded(()=>{copyChat(request,response);watchIdentity(this.scope,response?.clientThreadId);});return response;});
    }
    Object.defineProperty(prototype,'branch',{value:wrapped,writable:true,configurable:true});observedBranchers.add(prototype);branchers++;
    restores.push(()=>{if(prototype.branch===wrapped){if(own)Object.defineProperty(prototype,'branch',own);else delete prototype.branch;}});
  }
  function observeClient(client) {
    if (!client || typeof client.makeRequest !== 'function' || typeof client.safeGet !== 'function' || typeof client.safeDelete !== 'function') return;
    const own = Object.getOwnPropertyDescriptor(client,'makeRequest'), original = client.makeRequest;
    function wrapped(method, path, params) {
      let request = null;
      guarded(()=>{
        if (method === 'delete' && path === '/conversation/id/{conversation_id}' && id(params?.parameters?.path?.conversation_id)) {
          request = {kind:'delete',context:'chatgpt:'+params.parameters.path.conversation_id};
        } else if(method==='get'&&path==='/conversation/{conversation_id}'&&id(params?.parameters?.path?.conversation_id)) {
          request={kind:'read',context:'chatgpt:'+params.parameters.path.conversation_id};
        }
      });
      const result = Reflect.apply(original,this,arguments);
      if (!request || !result || typeof result.then !== 'function') return result;
      return result.then(response=>{
        if (!destroyed) guarded(()=>{
          if(request.kind==='read') {
            const path=chatPath(response),source=response?.metadata?.branching_from_conversation_id;
            if(path?.context===request.context&&id(source)&&source!==request.context.slice(8)) {
              guarded(()=>{if(!store.read(request.context).inherited)copies+=store.inherit('chatgpt:'+source,request.context,store.snapshot('chatgpt:'+source),path.messages);});
              guarded(()=>{if(!store.bookmarkData(request.context).inherited)bookmarkCopies+=store.inheritBookmarks('chatgpt:'+source,request.context,snapshotBookmarks('chatgpt:'+source),path.users);});
            }
          } else if(response !== false && response?.success !== false) { store.remove(request.context); deletions++; }
        });
        return response;
      },error=>{
        if (!destroyed && request.kind === 'delete' && error?.status === 404 && error?.errorCode === 'conversation_deleted') guarded(()=>{store.remove(request.context);deletions++;});
        throw error;
      });
    }
    Object.defineProperty(client,'makeRequest',{value:wrapped,writable:true,configurable:true}); clients++;
    restores.push(()=>{if(client.makeRequest===wrapped){if(own)Object.defineProperty(client,'makeRequest',own);else delete client.makeRequest;}});
  }
  function outgoing(event) {
    guarded(()=>{
      const data = event.detail, rpc = data?.type === 'mcp-request' ? data.request : null;
      if (!rpc || !id(rpc.id) || !id(data.hostId) || !['thread/fork','thread/delete'].includes(rpc.method) || !id(rpc.params?.threadId)) return;
      const context = 'codex:'+rpc.params.threadId;
      if (pending.size >= 200) pending.delete(pending.keys().next().value);
      pending.set(JSON.stringify([data.hostId,rpc.id]),{method:rpc.method,context,records:rpc.method==='thread/fork'?store.snapshot(context):null,at:Date.now()});
    });
  }
  function incoming(event) {
    // Match the native message listener's source/origin boundary; ignore other frames.
    if ((event.source != null && event.source !== window) || (event.source === window && event.origin !== location.origin)) return;
    acceptIncoming(event.data);
  }
  function acceptIncoming(data) {
    guarded(()=>{
      if (data?.type === 'mcp-notification' && data.method === 'thread/deleted' && id(data.hostId) && id(data.params?.threadId)) {
        store.remove('codex:'+data.params.threadId);deletions++;return;
      }
      if (data?.type !== 'mcp-response' || !id(data.hostId) || !id(data.response?.id)) return;
      const key = JSON.stringify([data.hostId,data.response.id]), request = pending.get(key); pending.delete(key);
      if (!request || Date.now()-request.at>300000 || data.response.error != null || !Object.hasOwn(data.response,'result')) return;
      if (request.method === 'thread/delete') {store.remove(request.context);deletions++;return;}
      const thread = data.response.result?.thread;
      if (!id(thread?.id) || !Array.isArray(thread.turns)) {failures++;return;}
      const messages = new Set();
      for (const turn of thread.turns) for (const item of turn.items || []) if (item.type === 'agentMessage' && id(item.id)) messages.add(item.id);
      copies += store.inherit(request.context,'codex:'+thread.id,request.records,messages);
    });
  }
  window.addEventListener('codex-message-from-view',outgoing);
  window.addEventListener('message',incoming);
  function findScopes() {
    const scopes=new Set(),seen=new Set(),fibers=new Set(),value=(object,key)=>Object.getOwnPropertyDescriptor(object,key)?.value;
    function visit(object,depth=0) {
      if(!object||typeof object!=='object'||depth>4||seen.has(object)||seen.size>=40000)return;
      seen.add(object);
      if(typeof object.get==='function'&&typeof object.set==='function'&&object.queryClient&&object.query)scopes.add(object);
      if(Array.isArray(object))for(const item of object.slice(0,500))visit(item,depth+1);
      else for(const key of ['current','value','memoizedState','memoCache','data','scope','searchSource','source','sources'])visit(value(object,key),depth+1);
    }
    for(const element of [...document.querySelectorAll('[data-turn-key],.thread-scroll-container')].slice(0,80)) {
      const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
      for(let fiber=key&&element[key],depth=0;fiber&&depth<100;depth++,fiber=fiber.return)fibers.add(fiber);
    }
    for(const fiber of fibers) {
      visit(fiber.memoizedProps);visit(fiber.updateQueue?.memoCache?.data);
      const hooks=new Set();
      for(let hook=fiber.memoizedState,count=0;hook&&count<256&&!hooks.has(hook);count++,hook=hook.next){hooks.add(hook);visit(hook.memoizedState);}
    }
    return scopes;
  }
  function refresh() {
    if(destroyed)return;
    if(identityAtom)for(const scope of findScopes())guarded(()=>observeScope(scope));
    // ChatGPT initializes its exported client class lazily when that surface first opens.
    for(const module of modules) for(const value of Object.values(module))
      if(typeof value==='function'&&typeof value.prototype?.branch==='function'&&typeof value.prototype.prepareCompletionStream==='function')
        guarded(()=>{if(Function.prototype.toString.call(value.prototype.branch).includes('/conversation/new_branch')||observedBranchers.has(value.prototype))observeBrancher(value.prototype);});
    if(!branchers&&branchAtoms.length) for(const scope of findScopes()) for(const atom of branchAtoms) guarded(()=>{
      const instance=scope.get(atom),prototype=instance&&Object.getPrototypeOf(instance);
      if(typeof prototype?.branch==='function'&&typeof prototype.prepareCompletionStream==='function'&&
         Function.prototype.toString.call(prototype.branch).includes('/conversation/new_branch')) {
        observeScope(instance.scope);observeBrancher(prototype);
      }
    });
  }
  let refreshQueued=false;
  const observer=new MutationObserver(()=>{
    if(!branchers&&!refreshQueued){refreshQueued=true;queueMicrotask(()=>{refreshQueued=false;refresh();});}
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  function summary() {return {installed:!destroyed,version:3,identityAvailable:!!identityAtom,identityWatchers:draftWatchers.size,clients,buses,branchers,identities,copies,bookmarkCopies,deletions,failures};}
  function destroy() {
    destroyed = true; pending.clear();observer.disconnect();window.removeEventListener('codex-message-from-view',outgoing);window.removeEventListener('message',incoming);
    for (const restore of restores.reverse()) guarded(restore);
    if (window.__chatAnnotationLifecycleV1?.destroy === destroy) delete window.__chatAnnotationLifecycleV1;
  }
  window.__chatAnnotationLifecycleV1 = {version:3,summary,refresh,destroy};
  try {
    let candidates = options.clients, branchPrototypes=options.branchers || [];
    if (!candidates) {
      const paths = new Set();
      function asset(path) {
        try {const url=new URL(path,'app://-/assets/');return url.protocol==='app:'&&url.hostname==='-'&&/^\/assets\/app-(shared|initial)-[\w.-]+\.js$/.test(url.pathname)&&!url.search&&!url.hash?url.href:null;}catch{return null;}
      }
      for (const entry of performance.getEntriesByType('resource')) {const path=asset(entry.name);if(path)paths.add(path);}
      for (const script of [...document.scripts].filter(script=>{
        try {const url=new URL(script.src);return url.protocol==='app:'&&url.hostname==='-'&&/^\/assets\/index-[\w.-]+\.js$/.test(url.pathname);}catch{return false;}
      }).slice(0,1)) {
        try {
          const response=await fetch(script.src,{signal:AbortSignal.timeout(4000)});
          if (!response.ok) continue;
          const source=await response.text();
          for(const match of source.matchAll(/app-(?:shared|initial)-[\w.-]+\.js/g)) {const path=asset(match[0]);if(path)paths.add(path);}
        }catch{failures++;}
      }
      candidates=[];
      for (const path of [...paths].slice(0,2)) {
        try {
        const module=await import(path);modules.push(module);let moduleSource=null;
        for(const value of Object.values(module)) {
          if(value&&typeof value==='object')candidates.push(value);
          if(typeof value==='function'&&typeof value.prototype?.branch==='function'&&typeof value.prototype.prepareCompletionStream==='function'&&
             value.prototype.branch.toString().includes('/conversation/new_branch'))branchPrototypes.push(value.prototype);
        }
        if(path.includes('/app-initial-')) {
          const response=await fetch(path,{signal:AbortSignal.timeout(4000)});
          if(response.ok) {
            const source=moduleSource=await response.text(),branch=source.indexOf('branch({conversationId:'),classAt=source.lastIndexOf('=class',branch);
            const className=source.slice(Math.max(0,classAt-80),classAt).match(/([\w$]+)$/)?.[1];
            if(branch>=0&&classAt>=0&&className&&source.slice(branch,branch+500).includes('/conversation/new_branch')) {
              const factory=source.match(new RegExp('([\\w$]+)=[\\w$]+\\([\\w$]+,\\(\\{scope:([\\w$]+)\\}\\)=>new '+className.replace(/\$/g,'\\$')+'\\(\\2\\)\\)'));
              if(factory) {
                const exported=source.slice(source.lastIndexOf('export{')).match(new RegExp('(?:\\{|,)'+factory[1].replace(/\$/g,'\\$')+' as ([\\w$]+)(?=[,}])'));
                const atom=exported&&module[exported[1]];
                if(atom&&typeof atom.resolve==='function'&&atom.scope)branchAtoms.push(atom);
              }
            }
          }
        }
        { // The resolver moved from app-shared to app-initial in newer builds.
          // Resolve the native draft-ID atom from the exported ID resolver, without fixed minified names.
          // Its contract is: null -> null, local ID -> get(identityAtom,id) ?? id, saved ID -> id conversion.
          let atomName=null;
          for(const value of Object.values(module)) if(typeof value==='function') {
            let source;try{source=Function.prototype.toString.call(value);}catch{continue;}if(source.length>300)continue;
            const match=source.match(/^function\s+[\w$]+\(([\w$]+),([\w$]+)\)\{return \2==null\?null:[\w$]+\(\2\)\?\1\(([\w$]+),\2\)\?\?\2:[\w$]+\(\2\)\}$/);
            if(match){atomName=match[3];break;}
          }
          if(atomName) {
            if(moduleSource===null){const response=await fetch(path,{signal:AbortSignal.timeout(4000)});if(response.ok)moduleSource=await response.text();}
            if(moduleSource!==null) {
              const source=moduleSource,exports=source.slice(source.lastIndexOf('export{'));
              const match=exports.match(new RegExp('(?:\\{|,)'+atomName.replace(/\$/g,'\\$')+' as ([\\w$]+)(?=[,}])'));
              if(match)identityAtom=module[match[1]];
            }
          }
        }
        }catch{failures++;}
      }
    }
    for(const prototype of new Set(branchPrototypes)) guarded(()=>observeBrancher(prototype));
    refresh();
    for (const client of new Set(candidates)) {
      if (destroyed) break;
      guarded(()=>observeClient(client));
      if (typeof client?.subscribe === 'function' && typeof client.dispatchHostMessage === 'function') guarded(()=>{
        restores.push(client.subscribe('mcp-response',acceptIncoming),client.subscribe('mcp-notification',acceptIncoming));buses++;
      });
    }
    if (buses) window.removeEventListener('message',incoming); // Native bus has already decoded chunked messages.
  } catch {failures++;}
  return summary();
}
if (typeof module !== 'undefined') module.exports = {installAnnotationLifecycle};
