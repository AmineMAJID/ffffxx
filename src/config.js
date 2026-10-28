'use strict';

const mib = (value) => value * 1024 * 1024;

/** Centralized limits keep upload, extraction, and session handling consistent. */
module.exports = Object.freeze({
  HOST: process.env.HOST || '0.0.0.0',
  PORT: Number.parseInt(process.env.PORT || '3000', 10),
  MAX_UPLOAD_BYTES: mib(25),
  MAX_ENTRY_BYTES: mib(50),
  MAX_EXTRACTED_BYTES: mib(100),
  MAX_ARCHIVE_ENTRIES: 2000,
  MAX_ENTRY_NAME_BYTES: 1024,
  JOB_TTL_MS: 30 * 60 * 1000,
  MAX_JOBS: 8,
  MAX_SESSION_BYTES: mib(250),
});
