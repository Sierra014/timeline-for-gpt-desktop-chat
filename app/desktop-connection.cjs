'use strict';
const port = 39223;
async function listTargets() {
  let response;
  try { response = await fetch('http://127.0.0.1:' + port + '/json/list', {signal:AbortSignal.timeout(3000), redirect:'error'}); }
  catch { throw Error('Local debugging unavailable. Run start-debug.cmd after fully exiting the client, or reuse the Timeline debug launcher.'); }
  if (!response.ok) throw Error('Desktop page list unavailable.');
  const pages = await response.json();
  if (!Array.isArray(pages)) throw Error('Invalid desktop page list.');
  return pages.filter(page => {
    if (page.type !== 'page' || typeof page.webSocketDebuggerUrl !== 'string') return false;
    try { const url = new URL(page.url); return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' && !/overlay/i.test(url.search + url.hash); }
    catch { return false; }
  });
}
async function evaluate(target, expression) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || Number(url.port) !== port) throw Error('Non-local debugger rejected.');
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Desktop connection timed out.')), 5000);
      socket.addEventListener('open', () => {clearTimeout(timer); resolve();}, {once:true});
      socket.addEventListener('error', () => {clearTimeout(timer); reject(Error('Desktop connection failed.'));}, {once:true});
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Desktop check timed out.')), 8000);
      socket.addEventListener('message', event => {
        let message; try {message = JSON.parse(event.data);} catch {return;}
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) {reject(Error('Desktop renderer rejected the operation.')); return;}
        const result = message.result?.result?.value;
        if (!result || typeof result !== 'object') {reject(Error('Invalid desktop result.')); return;}
        resolve(result);
      });
      socket.addEventListener('close', () => {clearTimeout(timer); reject(Error('Desktop connection closed.'));}, {once:true});
      socket.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression, returnByValue:true, awaitPromise:true}}));
    });
  } finally {socket.close();}
}
module.exports = {listTargets, evaluate};
