'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JobStore } = require('../src/job-store');

test('job deletion wipes retained buffers and releases memory accounting', () => {
  const store = new JobStore();
  const payload = Buffer.from('secret');
  const entryData = Buffer.from('entry');
  const job = store.create({ payload, entries: [{ data: entryData }], retainedBytes: 12 });
  assert.equal(store.retainedBytes, 12);
  assert.equal(store.delete(job.id), true);
  assert.equal(store.retainedBytes, 0);
  assert.deepEqual(payload, Buffer.alloc(6));
  assert.deepEqual(entryData, Buffer.alloc(5));
  store.close();
});

test('expired jobs are pruned and bounded stores evict the oldest job', () => {
  const expiring = new JobStore({ ttlMs: 1000 });
  const job = expiring.create({ entries: [], retainedBytes: 1 });
  expiring.prune(job.expiresAtMs);
  assert.equal(expiring.get(job.id), null);
  expiring.close();

  const bounded = new JobStore({ maxJobs: 1 });
  const first = bounded.create({ entries: [], retainedBytes: 1 });
  const second = bounded.create({ entries: [], retainedBytes: 1 });
  assert.equal(bounded.get(first.id), null);
  assert.equal(bounded.get(second.id).id, second.id);
  assert.equal(bounded.retainedBytes, 1);
  bounded.close();
});
