'use strict';

const { randomUUID } = require('node:crypto');
const { JOB_TTL_MS, MAX_JOBS, MAX_SESSION_BYTES } = require('./config');

function wipeJob(job) {
  if (!job) return;
  if (Buffer.isBuffer(job.payload)) job.payload.fill(0);
  if (Array.isArray(job.entries)) {
    for (const entry of job.entries) {
      if (Buffer.isBuffer(entry.data)) entry.data.fill(0);
    }
  }
}

/** A bounded, memory-only job store suitable for this single-process tool. */
class JobStore {
  constructor({ ttlMs = JOB_TTL_MS, maxJobs = MAX_JOBS, maxBytes = MAX_SESSION_BYTES } = {}) {
    this.ttlMs = ttlMs;
    this.maxJobs = maxJobs;
    this.maxBytes = maxBytes;
    this.jobs = new Map();
    this.retainedBytes = 0;
    this.cleanupTimer = setInterval(() => this.prune(), 60 * 1000);
    this.cleanupTimer.unref();
  }

  prune(now = Date.now()) {
    for (const [id, job] of this.jobs) {
      if (job.expiresAtMs <= now) this.delete(id);
    }
  }

  create(fields) {
    this.prune();
    const retainedBytes = Math.max(0, Number(fields.retainedBytes) || 0);

    // Evict oldest jobs first so one browser cannot grow memory without bound.
    while (
      this.jobs.size > 0
      && (this.jobs.size >= this.maxJobs || this.retainedBytes + retainedBytes > this.maxBytes)
    ) {
      this.delete(this.jobs.keys().next().value);
    }

    const id = randomUUID();
    const now = Date.now();
    const job = {
      ...fields,
      id,
      createdAtMs: now,
      expiresAtMs: now + this.ttlMs,
      retainedBytes,
    };
    this.jobs.set(id, job);
    this.retainedBytes += retainedBytes;
    return job;
  }

  get(id) {
    if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) return null;
    const job = this.jobs.get(id) || null;
    if (job && job.expiresAtMs <= Date.now()) {
      this.delete(id);
      return null;
    }
    return job;
  }

  delete(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    this.retainedBytes = Math.max(0, this.retainedBytes - job.retainedBytes);
    wipeJob(job);
    return true;
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const id of this.jobs.keys()) this.delete(id);
  }
}

module.exports = { JobStore };
