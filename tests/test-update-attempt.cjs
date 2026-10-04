'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {installInChatGPT} = require('../app/timeline-chat-adapter.cjs');
const {resolveNativeTimeline} = require('../app/timeline-native-resolver.cjs');
const build = require('../app/timeline-compatibility.json');

(async () => {
  const context = vm.createContext({window: {}, URL, AbortSignal, document: {scripts: [{src: 'app://-/assets/index-updated.js'}]}});
  const atom = {}, imports = [];
  const importer = async url => {
    imports.push(url);
    const values = url === build.historyModule ? {[build.historyExport]: atom} : {default: {renderToString() {}}};
    const module = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, {context});
    await module.link(() => {}); await module.evaluate(); return module;
  };
  const resolve = vm.runInContext('(' + resolveNativeTimeline.toString() + ')', context, {importModuleDynamically: importer});
  const install = vm.runInContext('(' + installInChatGPT.toString() + ')', context, {
    importModuleDynamically: async url => {
      imports.push(url);
      const values = url === build.historyModule ? {[build.historyExport]: atom} : {default: {renderToString() {}}};
      const module = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, {context});
      await module.link(() => {}); await module.evaluate(); return module;
    },
  });
  let installations = 0;
  const result = await install(() => {installations++; return {installed: true};}, candidate => {
    if (candidate) assert.equal(candidate, atom);
    return {entries: [{key: 'PRIVATE-KEY', text: 'PRIVATE-TEXT'}], api: {}, historyStateAvailable: !!candidate};
  }, {compatibility: build}, resolve);
  assert.equal(result.installed, true, 'An updated entry fingerprint must attempt the available adapter instead of refusing the build');
  assert.equal(installations, 1); assert.ok(imports.includes(build.historyModule));
  assert.equal(JSON.stringify(result).includes('PRIVATE-'), false);
  console.log('PASS: updated build attempts the available adapter and installs when capabilities work.');
})().catch(error => {console.error(error); process.exitCode = 1;});
