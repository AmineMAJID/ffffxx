'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { buildArchive, extractArchive, normalizeEntryName } = require('../src/archive');
const { makeZip } = require('./helpers');

test('archive entries are extracted and can be rebuilt without removed files', () => {
  const original = makeZip({
    'fxmanifest.lua': "games { 'gta5' }",
    'client/main.lua': 'print("hello")',
    'README.md': 'Fixture',
  });
  const archive = extractArchive(original);
  assert.equal(archive.entries.length, 3);
  assert.equal(
    archive.totalSize,
    Buffer.byteLength("games { 'gta5' }") + Buffer.byteLength('print("hello")') + Buffer.byteLength('Fixture'),
  );

  archive.entries.find((entry) => entry.name === 'README.md').removed = true;
  const rebuilt = new AdmZip(buildArchive(archive.entries));
  const names = rebuilt.getEntries().map((entry) => entry.entryName).sort();
  assert.deepEqual(names, ['client/main.lua', 'fxmanifest.lua']);
  assert.equal(rebuilt.readAsText('client/main.lua'), 'print("hello")');
});

test('clearing every entry still creates a valid empty ZIP', () => {
  const archive = extractArchive(makeZip({ 'a.txt': 'a', 'b.txt': 'b' }));
  for (const entry of archive.entries) entry.removed = true;
  const output = buildArchive(archive.entries);
  assert.equal(new AdmZip(output).getEntries().length, 0);
  assert.ok(output.length >= 22);
});

test('unsafe archive paths are rejected before extraction', () => {
  assert.throws(() => normalizeEntryName('../outside.txt'), { code: 'UNSAFE_ARCHIVE_PATH' });
  assert.throws(() => normalizeEntryName('/absolute.txt'), { code: 'UNSAFE_ARCHIVE_PATH' });
  assert.throws(() => normalizeEntryName('C:\\outside.txt'), { code: 'UNSAFE_ARCHIVE_PATH' });
  assert.throws(() => normalizeEntryName('folder/./file.txt'), { code: 'UNSAFE_ARCHIVE_PATH' });
  assert.equal(normalizeEntryName('folder\\file.txt'), 'folder/file.txt');
});

test('a corrupt archive reports a controlled extraction error', () => {
  const zip = makeZip({ 'a.txt': 'content' });
  assert.throws(() => extractArchive(zip.subarray(0, 20)), { code: 'INVALID_ZIP' });
});
