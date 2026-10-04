'use strict';
const fs = require('node:fs');
const path = require('node:path');

function dataPath(name) {
  if (path.basename(name) !== name) throw Error('Expected a local data file name.');
  const folder = path.join(__dirname, 'data');
  fs.mkdirSync(folder, {recursive: true});
  const destination = path.join(folder, name);
  // Preserve data from older portable versions when this source is upgraded in place.
  // Exclusive copy leaves an existing destination and the original file untouched.
  try { fs.copyFileSync(path.join(__dirname, name), destination, fs.constants.COPYFILE_EXCL); }
  catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
  return destination;
}
module.exports = {dataPath};
