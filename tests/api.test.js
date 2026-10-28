'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const AdmZip = require('adm-zip');
const { createApp } = require('../src/app');
const { makeZip, wrapOuter } = require('./helpers');

let server;
let baseUrl;
let app;

test.before(async () => {
  app = createApp();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  app.locals.jobStore.close();
  server.close();
  await once(server, 'close');
});

async function upload(buffer, name, contentKey) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/octet-stream' }), name);
  if (contentKey) form.append('contentKey', contentKey);
  const response = await fetch(`${baseUrl}/api/jobs`, { method: 'POST', body: form });
  return { response, body: await response.json() };
}

test('health endpoint reports readiness', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('complete upload, inspect, remove, reset, clear, and download workflow', async () => {
  const source = wrapOuter(makeZip({
    'fxmanifest.lua': "fx_version 'cerulean'",
    'client/main.lua': 'print("hello")',
    'README.md': 'remove me',
  }));
  const created = await upload(source, 'owned-resource.fxap');
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  let job = created.body.job;
  assert.equal(job.kind, 'archive');
  assert.equal(job.stats.remainingFiles, 3);
  assert.equal(job.entries.length, 3);

  const readMe = job.entries.find((entry) => entry.name === 'README.md');
  const removed = await fetch(`${baseUrl}/api/jobs/${job.id}/entries`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [readMe.id] }),
  });
  assert.equal(removed.status, 200);
  job = (await removed.json()).job;
  assert.equal(job.stats.removedFiles, 1);
  assert.equal(job.stats.remainingFiles, 2);

  const downloaded = await fetch(`${baseUrl}${job.downloadUrl}`);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get('content-disposition'), /processed\.zip/);
  const outputZip = new AdmZip(Buffer.from(await downloaded.arrayBuffer()));
  assert.deepEqual(
    outputZip.getEntries().map((entry) => entry.entryName).sort(),
    ['client/main.lua', 'fxmanifest.lua'],
  );

  const reset = await fetch(`${baseUrl}/api/jobs/${job.id}/reset`, { method: 'POST' });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).job.stats.remainingFiles, 3);

  const cleared = await fetch(`${baseUrl}/api/jobs/${job.id}/clear`, { method: 'POST' });
  assert.equal(cleared.status, 200);
  job = (await cleared.json()).job;
  assert.equal(job.stats.remainingFiles, 0);
  assert.equal(job.entries.length, 0);

  const emptyDownload = await fetch(`${baseUrl}${job.downloadUrl}`);
  const emptyZip = new AdmZip(Buffer.from(await emptyDownload.arrayBuffer()));
  assert.equal(emptyZip.getEntries().length, 0);

  const deleted = await fetch(`${baseUrl}/api/jobs/${job.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/jobs/${job.id}`)).status, 404);
});

test('a decoded non-ZIP payload can be downloaded without pretending extraction worked', async () => {
  const payload = Buffer.alloc(96, 0x24);
  const created = await upload(wrapOuter(payload), 'descriptor.fxap');
  assert.equal(created.response.status, 201);
  const job = created.body.job;
  assert.equal(job.kind, 'binary');
  assert.equal(job.payloadType, 'binary');
  assert.equal(job.entries.length, 0);

  const response = await fetch(`${baseUrl}${job.downloadUrl}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
});

test('invalid files and unsupported extensions return controlled API errors', async () => {
  const invalid = await upload(Buffer.from('plain text'), 'broken.fxap');
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.body.error.code, 'INVALID_FILE_SIGNATURE');

  const extension = await upload(makeZip(), 'archive.rar');
  assert.equal(extension.response.status, 415);
  assert.equal(extension.body.error.code, 'UNSUPPORTED_FILE_TYPE');
});
