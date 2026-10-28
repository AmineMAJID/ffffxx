'use strict';

const crypto = require('node:crypto');
const { AppError } = require('./errors');

const FXAP_MAGIC = Buffer.from('FXAP');
const ZIP_LOCAL_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const LUA_MAGIC = Buffer.from([0x1b, 0x4c, 0x75, 0x61]);

// The outer FXAP container key is part of the FiveM-compatible container format.
// A separate asset/content key is never assumed, fetched, or derived by this app.
const OUTER_CONTAINER_KEY = Buffer.from([
  0xb3, 0xcb, 0x2e, 0x04, 0x87, 0x94, 0xd6, 0x73,
  0x08, 0x23, 0xc4, 0x93, 0x7a, 0xbd, 0x18, 0xad,
  0x6b, 0xe6, 0xdc, 0xb3, 0x91, 0x43, 0x0d, 0x28,
  0xf9, 0x40, 0x9d, 0x48, 0x37, 0xb9, 0x38, 0xfb,
]);

function startsWith(buffer, magic) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= magic.length
    && buffer.subarray(0, magic.length).equals(magic);
}

function isFxap(buffer) {
  return startsWith(buffer, FXAP_MAGIC);
}

function isZip(buffer) {
  return startsWith(buffer, ZIP_LOCAL_MAGIC) || startsWith(buffer, ZIP_EMPTY_MAGIC);
}

/**
 * FiveM's ChaCha20 layout uses a zero 32-bit counter followed by a 96-bit nonce.
 * ChaCha20 is symmetric, so this helper is also used by tests to make fixtures.
 */
function chacha20(key, nonce, input) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new AppError(400, 'INVALID_CONTENT_KEY', 'A content key must contain exactly 32 bytes.');
  }
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12) {
    throw new AppError(422, 'INVALID_FXAP_NONCE', 'The FXAP container has an invalid nonce.');
  }

  const iv = Buffer.alloc(16);
  nonce.copy(iv, 4);
  const cipher = crypto.createDecipheriv('chacha20', key, iv);
  return Buffer.concat([cipher.update(input), cipher.final()]);
}

function parseContentKey(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = String(value).trim().replace(/\s+/g, '');
  if (!/^[a-f\d]{64}$/i.test(normalized)) {
    throw new AppError(
      400,
      'INVALID_CONTENT_KEY',
      'The optional content key must be exactly 64 hexadecimal characters (32 bytes).',
    );
  }
  return Buffer.from(normalized, 'hex');
}

function decryptAt(buffer, key, payloadOffset, ivOffset) {
  if (!Number.isInteger(payloadOffset) || !Number.isInteger(ivOffset)) return null;
  if (ivOffset < 0 || payloadOffset <= ivOffset || ivOffset + 12 > payloadOffset) return null;
  if (payloadOffset >= buffer.length) return null;
  return chacha20(key, buffer.subarray(ivOffset, ivOffset + 12), buffer.subarray(payloadOffset));
}

/** Decode the optional content layer using its named or legacy header layout. */
function decryptInner(buffer, key) {
  if (buffer.length >= 18) {
    const nameLength = buffer.readUInt16LE(4);
    const ivOffset = 6 + nameLength;
    const payloadOffset = ivOffset + 12;
    const result = decryptAt(buffer, key, payloadOffset, ivOffset);
    if (result) return result;
  }

  // Older FXAP-wrapped payloads used fixed nonce/payload offsets.
  const legacy = decryptAt(buffer, key, 92, 80);
  if (legacy) return legacy;

  throw new AppError(
    422,
    'UNSUPPORTED_FXAP_LAYOUT',
    'The decoded FXAP content header is truncated or uses an unsupported layout.',
  );
}

function detectPayloadType(buffer) {
  if (isZip(buffer)) return 'zip';
  if (startsWith(buffer, LUA_MAGIC)) return 'lua-bytecode';
  if (startsWith(buffer, Buffer.from('RSC7'))) return 'rsc7';
  if (startsWith(buffer, Buffer.from('RSC8'))) return 'rsc8';
  return 'binary';
}

/**
 * Decode a ZIP directly, or decode the FXAP outer layer and optional inner layer.
 * No Keymaster requests or entitlement bypasses are performed.
 */
function decodeInput(input, { contentKey: rawContentKey } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new AppError(422, 'EMPTY_FILE', 'The uploaded file is empty.');
  }

  if (isZip(input)) {
    return {
      data: input,
      inputKind: 'zip',
      layers: ['zip'],
      payloadType: 'zip',
      resourceId: null,
    };
  }

  if (!isFxap(input)) {
    throw new AppError(
      422,
      'INVALID_FILE_SIGNATURE',
      'This file is neither a ZIP archive nor an FXAP container. Expected a PK or FXAP signature.',
    );
  }

  if (input.length <= 86) {
    throw new AppError(422, 'TRUNCATED_FXAP', 'The FXAP container is too short to contain a valid payload.');
  }

  const outer = chacha20(OUTER_CONTAINER_KEY, input.subarray(74, 86), input.subarray(86));
  const key = parseContentKey(rawContentKey);
  // Resource IDs belong to decoded descriptor metadata, not arbitrary bytes at
  // the same offset in an embedded ZIP or a separately wrapped content layer.
  const resourceId = !key && detectPayloadType(outer) === 'binary' && outer.length >= 78
    ? outer.readUInt32BE(74)
    : 0;
  let data = outer;
  const layers = ['fxap-outer'];

  try {
    if (key) {
      data = decryptInner(outer, key);
      layers.push('fxap-inner');
    }
  } finally {
    // Do not retain caller-provided key material longer than necessary.
    if (key) key.fill(0);
  }

  return {
    data,
    inputKind: 'fxap',
    layers,
    payloadType: detectPayloadType(data),
    resourceId: resourceId > 0 ? String(resourceId) : null,
  };
}

module.exports = {
  chacha20,
  decodeInput,
  detectPayloadType,
  isFxap,
  isZip,
  parseContentKey,
};
