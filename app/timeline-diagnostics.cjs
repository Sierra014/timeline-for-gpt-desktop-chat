'use strict';
const fs = require('node:fs');
const {dataPath} = require('./timeline-paths.cjs');
const build = require('./timeline-compatibility.json');

// Callers provide capability summaries only. Never log raw exceptions, target URLs,
// React objects, message contents, account identifiers or conversation identifiers.
function writeDiagnostics(event, metadata = {}) {
  try {
    const file = dataPath('timeline-diagnostics.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 1000000) fs.renameSync(file, file + '.previous');
    fs.appendFileSync(file, JSON.stringify({at: new Date().toISOString(), toolVersion: build.toolVersion, event, ...metadata}) + '\n', 'utf8');
  } catch { console.error('Could not write data/timeline-diagnostics.jsonl; check folder write access.'); }
}
module.exports = {writeDiagnostics};
