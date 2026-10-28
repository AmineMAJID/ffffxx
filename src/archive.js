'use strict';

const { randomUUID } = require('node:crypto');
const AdmZip = require('adm-zip');
const { AppError } = require('./errors');
const {
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_ENTRY_NAME_BYTES,
  MAX_EXTRACTED_BYTES,
} = require('./config');

function normalizeEntryName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw new AppError(422, 'INVALID_ARCHIVE_PATH', 'The archive contains an empty entry name.');
  }

  // ZIP uses forward slashes. Normalizing backslashes avoids ambiguous paths.
  const name = rawName.replace(/\\/g, '/');
  if (Buffer.byteLength(name, 'utf8') > MAX_ENTRY_NAME_BYTES) {
    throw new AppError(422, 'INVALID_ARCHIVE_PATH', 'An archive entry name exceeds 1024 bytes.');
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new AppError(422, 'INVALID_ARCHIVE_PATH', 'An archive entry name contains control characters.');
  }
  if (name.startsWith('/') || /^[a-z]:/i.test(name)) {
    throw new AppError(422, 'UNSAFE_ARCHIVE_PATH', `Absolute archive paths are not allowed: ${rawName}`);
  }

  const segments = name.split('/');
  const isDirectory = name.endsWith('/');
  const meaningfulSegments = isDirectory ? segments.slice(0, -1) : segments;
  if (meaningfulSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new AppError(
      422,
      'UNSAFE_ARCHIVE_PATH',
      `Unsafe or ambiguous archive path: ${rawName}`,
    );
  }

  return name;
}

function safeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1980) {
    return new Date('1980-01-01T00:00:00.000Z');
  }
  return date;
}

/**
 * Extract entries in memory. No untrusted archive path is ever sent to fs or
 * extractAllTo, which prevents ZIP-slip and symlink writes on the host.
 */
function extractArchive(buffer) {
  let zip;
  let sourceEntries;
  try {
    zip = new AdmZip(buffer);
    sourceEntries = zip.getEntries();
  } catch (error) {
    throw new AppError(422, 'INVALID_ZIP', `The ZIP central directory could not be read: ${error.message}`);
  }

  if (sourceEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new AppError(
      413,
      'TOO_MANY_ARCHIVE_ENTRIES',
      `The archive has ${sourceEntries.length} entries; the limit is ${MAX_ARCHIVE_ENTRIES}.`,
    );
  }

  const entries = [];
  const seenNames = new Set();
  let totalSize = 0;
  let actualTotalSize = 0;

  for (const source of sourceEntries) {
    const name = normalizeEntryName(source.entryName);
    if (seenNames.has(name)) {
      throw new AppError(422, 'DUPLICATE_ARCHIVE_PATH', `Duplicate archive entry: ${name}`);
    }
    seenNames.add(name);

    if (source.header.encrypted) {
      throw new AppError(422, 'ENCRYPTED_ZIP', `Password-protected ZIP entries are not supported: ${name}`);
    }

    const unixType = (source.attr >>> 16) & 0o170000;
    if (unixType === 0o120000) {
      throw new AppError(422, 'UNSUPPORTED_ARCHIVE_ENTRY', `Symbolic links are not supported: ${name}`);
    }

    const declaredSize = Number(source.header.size);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_ENTRY_BYTES) {
      throw new AppError(
        413,
        'ARCHIVE_ENTRY_TOO_LARGE',
        `${name} exceeds the 50 MiB per-file extraction limit.`,
      );
    }

    totalSize += declaredSize;
    if (totalSize > MAX_EXTRACTED_BYTES) {
      throw new AppError(
        413,
        'ARCHIVE_TOO_LARGE',
        'The archive expands beyond the 100 MiB total extraction limit.',
      );
    }

    let data = Buffer.alloc(0);
    if (!source.isDirectory) {
      try {
        data = source.getData();
      } catch (error) {
        throw new AppError(422, 'ARCHIVE_EXTRACTION_FAILED', `Could not extract ${name}: ${error.message}`);
      }

      if (data.length > MAX_ENTRY_BYTES) {
        throw new AppError(413, 'ARCHIVE_ENTRY_TOO_LARGE', `${name} exceeds the 50 MiB per-file limit.`);
      }
      actualTotalSize += data.length;
      if (actualTotalSize > MAX_EXTRACTED_BYTES) {
        throw new AppError(413, 'ARCHIVE_TOO_LARGE', 'The extracted files exceed the 100 MiB total limit.');
      }
    }

    const mode = (source.attr >>> 16) & 0o777;
    entries.push({
      id: randomUUID(),
      name,
      data,
      isDirectory: Boolean(source.isDirectory),
      removed: false,
      size: data.length,
      compressedSize: Number(source.header.compressedSize) || 0,
      lastModified: safeDate(source.header.time),
      mode: mode || (source.isDirectory ? 0o755 : 0o644),
      comment: typeof source.comment === 'string' ? source.comment.slice(0, 1024) : '',
    });
  }

  return {
    entries,
    totalSize: actualTotalSize,
  };
}

/** Build a fresh ZIP from active entries, omitting every removed entry. */
function buildArchive(entries) {
  const zip = new AdmZip();

  for (const entry of entries) {
    if (entry.removed) continue;
    const outputEntry = zip.addFile(
      entry.name,
      entry.isDirectory ? Buffer.alloc(0) : entry.data,
      entry.comment,
      entry.mode,
    );
    outputEntry.header.time = safeDate(entry.lastModified);
  }

  return zip.toBuffer();
}

module.exports = {
  buildArchive,
  extractArchive,
  normalizeEntryName,
};
