'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const {
  MAX_ARCHIVE_ENTRIES,
  MAX_UPLOAD_BYTES,
} = require('./config');
const { AppError } = require('./errors');
const { decodeInput, isZip } = require('./fxap');
const { buildArchive, extractArchive } = require('./archive');
const { JobStore } = require('./job-store');

function cleanOriginalName(value) {
  const basename = String(value || 'upload.fxap')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .trim();
  return (basename || 'upload.fxap').slice(0, 160);
}

function outputBaseName(originalName) {
  return originalName.replace(/\.(fxap|zip)$/i, '').trim() || 'resource';
}

function decodedExtension(payloadType) {
  if (payloadType === 'lua-bytecode') return 'luac';
  if (payloadType === 'rsc7' || payloadType === 'rsc8') return 'rsc';
  return 'bin';
}

function serializeJob(job) {
  const allEntries = job.entries || [];
  const allFiles = allEntries.filter((entry) => !entry.isDirectory);
  const remainingFiles = allFiles.filter((entry) => !entry.removed);
  const originalBytes = allFiles.reduce((sum, entry) => sum + entry.size, 0);
  const remainingBytes = remainingFiles.reduce((sum, entry) => sum + entry.size, 0);

  return {
    id: job.id,
    kind: job.kind,
    originalName: job.originalName,
    downloadName: job.downloadName,
    inputKind: job.inputKind,
    inputSize: job.inputSize,
    decodedSize: job.decodedSize,
    payloadType: job.payloadType,
    resourceId: job.resourceId,
    layers: job.layers,
    createdAt: new Date(job.createdAtMs).toISOString(),
    expiresAt: new Date(job.expiresAtMs).toISOString(),
    downloadUrl: `/api/jobs/${job.id}/download`,
    entries: remainingFiles.map((entry) => ({
      id: entry.id,
      name: entry.name,
      size: entry.size,
      compressedSize: entry.compressedSize,
      lastModified: entry.lastModified.toISOString(),
    })),
    stats: {
      originalFiles: allFiles.length,
      remainingFiles: remainingFiles.length,
      removedFiles: allFiles.length - remainingFiles.length,
      originalEntries: allEntries.length,
      remainingEntries: allEntries.filter((entry) => !entry.removed).length,
      removedEntries: allEntries.filter((entry) => entry.removed).length,
      originalBytes,
      remainingBytes,
    },
  };
}

function requireJob(store, id) {
  const job = store.get(id);
  if (!job) {
    throw new AppError(
      404,
      'JOB_NOT_FOUND',
      'This workspace has expired or no longer exists. Upload the file again to start a new session.',
    );
  }
  return job;
}

function createApp(options = {}) {
  const app = express();
  const store = options.store || new JobStore();
  app.locals.jobStore = store;
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '256kb', strict: true }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 4,
      parts: 5,
      fieldNameSize: 64,
      fieldSize: 4096,
    },
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', limits: { uploadBytes: MAX_UPLOAD_BYTES } });
  });

  /** Upload, decode, and (when possible) extract in a single API operation. */
  app.post('/api/jobs', upload.single('file'), (req, res, next) => {
    if (!req.file) {
      return next(new AppError(400, 'FILE_REQUIRED', 'Choose one .fxap or .zip file to upload.'));
    }

    const originalName = cleanOriginalName(req.file.originalname);
    if (!/\.(fxap|zip)$/i.test(originalName)) {
      req.file.buffer.fill(0);
      return next(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .fxap and .zip files are accepted.'));
    }

    let decoded;
    let transferredToJob = false;
    try {
      decoded = decodeInput(req.file.buffer, { contentKey: req.body.contentKey });
      const common = {
        originalName,
        inputKind: decoded.inputKind,
        inputSize: req.file.size,
        decodedSize: decoded.data.length,
        payloadType: decoded.payloadType,
        resourceId: decoded.resourceId,
        layers: decoded.layers,
      };

      let job;
      if (isZip(decoded.data)) {
        const archive = extractArchive(decoded.data);
        job = store.create({
          ...common,
          kind: 'archive',
          entries: archive.entries,
          downloadName: `${outputBaseName(originalName)}-processed.zip`,
          retainedBytes: archive.totalSize,
        });
        // Extracted entry buffers are independent of the compressed input.
        decoded.data.fill(0);
      } else {
        job = store.create({
          ...common,
          kind: 'binary',
          entries: [],
          payload: decoded.data,
          downloadName: `${outputBaseName(originalName)}-decoded.${decodedExtension(decoded.payloadType)}`,
          retainedBytes: decoded.data.length,
        });
        transferredToJob = true;
      }

      return res.status(201).json({ job: serializeJob(job) });
    } catch (error) {
      if (decoded && !transferredToJob && Buffer.isBuffer(decoded.data)) decoded.data.fill(0);
      return next(error);
    } finally {
      req.file.buffer.fill(0);
    }
  });

  app.get('/api/jobs/:id', (req, res) => {
    res.json({ job: serializeJob(requireJob(store, req.params.id)) });
  });

  /** Remove selected files by their opaque session-specific entry IDs. */
  app.delete('/api/jobs/:id/entries', (req, res) => {
    const job = requireJob(store, req.params.id);
    if (job.kind !== 'archive') {
      throw new AppError(409, 'NOT_AN_ARCHIVE', 'This decoded payload is not a ZIP archive and has no entries to remove.');
    }

    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ARCHIVE_ENTRIES) {
      throw new AppError(400, 'INVALID_ENTRY_SELECTION', 'Provide between 1 and 2,000 entry IDs to remove.');
    }
    if (ids.some((id) => typeof id !== 'string')) {
      throw new AppError(400, 'INVALID_ENTRY_SELECTION', 'Every entry ID must be a string.');
    }

    const uniqueIds = new Set(ids);
    const selected = [];
    for (const id of uniqueIds) {
      const entry = job.entries.find((candidate) => candidate.id === id && !candidate.isDirectory);
      if (!entry) throw new AppError(400, 'UNKNOWN_ENTRY', 'One or more selected entries do not belong to this workspace.');
      selected.push(entry);
    }
    for (const entry of selected) entry.removed = true;
    res.json({ job: serializeJob(job) });
  });

  /** Clear every file and directory while retaining the job for reset/download. */
  app.post('/api/jobs/:id/clear', (req, res) => {
    const job = requireJob(store, req.params.id);
    if (job.kind !== 'archive') throw new AppError(409, 'NOT_AN_ARCHIVE', 'Only archive workspaces can be cleared.');
    for (const entry of job.entries) entry.removed = true;
    res.json({ job: serializeJob(job) });
  });

  /** Restore the initially extracted archive without requiring another upload. */
  app.post('/api/jobs/:id/reset', (req, res) => {
    const job = requireJob(store, req.params.id);
    if (job.kind !== 'archive') throw new AppError(409, 'NOT_AN_ARCHIVE', 'Only archive workspaces can be reset.');
    for (const entry of job.entries) entry.removed = false;
    res.json({ job: serializeJob(job) });
  });

  app.get('/api/jobs/:id/download', (req, res, next) => {
    try {
      const job = requireJob(store, req.params.id);
      // Copy raw payloads so a concurrent expiry/explicit wipe cannot mutate an
      // in-flight response buffer. Archive builds already return a fresh buffer.
      const output = job.kind === 'archive' ? buildArchive(job.entries) : Buffer.from(job.payload);
      res.attachment(job.downloadName);
      res.type(job.kind === 'archive' ? 'application/zip' : 'application/octet-stream');
      res.set('Content-Length', String(output.length));
      res.send(output);
    } catch (error) {
      next(error);
    }
  });

  /** Explicitly wipe a job; expiration and bounded-store eviction do the same. */
  app.delete('/api/jobs/:id', (req, res) => {
    store.delete(req.params.id);
    res.status(204).end();
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'API_NOT_FOUND', message: 'API endpoint not found.' } });
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  }));

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  });

  // Centralized, consistent API errors—including Multer and malformed JSON.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    let normalized = error;
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        normalized = new AppError(413, 'FILE_TOO_LARGE', 'The uploaded file exceeds the 25 MiB limit.');
      } else {
        normalized = new AppError(400, 'UPLOAD_ERROR', `Upload failed: ${error.message}`);
      }
    } else if (error && error.type === 'entity.parse.failed') {
      normalized = new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
    }

    const status = normalized.status || 500;
    const code = normalized.code || 'INTERNAL_ERROR';
    const message = status >= 500
      ? 'An unexpected server error occurred. Please try again.'
      : normalized.message;
    if (status >= 500) console.error(error);

    return res.status(status).json({
      error: {
        code,
        message,
        ...(normalized.details ? { details: normalized.details } : {}),
      },
    });
  });

  return app;
}

module.exports = { createApp, serializeJob };
