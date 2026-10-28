'use strict';

const AdmZip = require('adm-zip');
const { chacha20 } = require('../src/fxap');

const OUTER_KEY = Buffer.from([
  0xb3, 0xcb, 0x2e, 0x04, 0x87, 0x94, 0xd6, 0x73,
  0x08, 0x23, 0xc4, 0x93, 0x7a, 0xbd, 0x18, 0xad,
  0x6b, 0xe6, 0xdc, 0xb3, 0x91, 0x43, 0x0d, 0x28,
  0xf9, 0x40, 0x9d, 0x48, 0x37, 0xb9, 0x38, 0xfb,
]);

function makeZip(files = { 'hello.txt': 'Hello, FiveM!' }) {
  const zip = new AdmZip();
  for (const [name, value] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  return zip.toBuffer();
}

/** Build an outer FXAP fixture; the same ChaCha20 function encrypts/decrypts. */
function wrapOuter(payload, nonce = Buffer.from('000102030405060708090a0b', 'hex')) {
  const header = Buffer.alloc(86);
  header.write('FXAP', 0);
  nonce.copy(header, 74);
  return Buffer.concat([header, chacha20(OUTER_KEY, nonce, payload)]);
}

function wrapInner(payload, key, name = 'archive.zip') {
  const nameBuffer = Buffer.from(name);
  const nonce = Buffer.from('0c0d0e0f1011121314151617', 'hex');
  const header = Buffer.alloc(6 + nameBuffer.length + 12);
  header.writeUInt16LE(nameBuffer.length, 4);
  nameBuffer.copy(header, 6);
  nonce.copy(header, 6 + nameBuffer.length);
  return Buffer.concat([header, chacha20(key, nonce, payload)]);
}

module.exports = { makeZip, wrapInner, wrapOuter };
