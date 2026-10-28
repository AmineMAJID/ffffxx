'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chacha20, decodeInput, isZip } = require('../src/fxap');
const { makeZip, wrapInner, wrapOuter } = require('./helpers');

test('ChaCha20 counter/nonce layout matches the FXAP reference vector', () => {
  const key = Buffer.from([...Array(32).keys()]);
  const nonce = Buffer.from('000102030405060708090a0b', 'hex');
  const input = Buffer.from([...Array(128).keys()]);
  const output = chacha20(key, nonce, input);
  assert.equal(output.subarray(0, 16).toString('hex'), '103bf312c58e529a312d85bb716dcc95');
  assert.deepEqual(chacha20(key, nonce, output), input);
});

test('a plain ZIP passes through without decryption', () => {
  const zip = makeZip();
  const decoded = decodeInput(zip);
  assert.equal(decoded.inputKind, 'zip');
  assert.deepEqual(decoded.layers, ['zip']);
  assert.equal(decoded.payloadType, 'zip');
  assert.ok(isZip(decoded.data));
});

test('outer FXAP decoding recovers an embedded ZIP', () => {
  const zip = makeZip({ 'fxmanifest.lua': "fx_version 'cerulean'" });
  const decoded = decodeInput(wrapOuter(zip));
  assert.equal(decoded.inputKind, 'fxap');
  assert.deepEqual(decoded.layers, ['fxap-outer']);
  assert.equal(decoded.payloadType, 'zip');
  assert.deepEqual(decoded.data, zip);
});

test('an owner-supplied content key decodes the inner named layout', () => {
  const zip = makeZip({ 'client.lua': 'print("owned fixture")' });
  const key = Buffer.alloc(32, 7);
  const inner = wrapInner(zip, key);
  const decoded = decodeInput(wrapOuter(inner), { contentKey: key.toString('hex') });
  assert.deepEqual(decoded.layers, ['fxap-outer', 'fxap-inner']);
  assert.equal(decoded.payloadType, 'zip');
  assert.deepEqual(decoded.data, zip);
});

test('non-ZIP decoded data is returned honestly as binary', () => {
  const payload = Buffer.alloc(96, 0x42);
  const decoded = decodeInput(wrapOuter(payload));
  assert.equal(decoded.kind, undefined);
  assert.equal(decoded.payloadType, 'binary');
  assert.deepEqual(decoded.data, payload);
});

test('invalid signatures and malformed keys produce useful errors', () => {
  assert.throws(() => decodeInput(Buffer.from('not an fxap file')), {
    code: 'INVALID_FILE_SIGNATURE',
  });
  assert.throws(() => decodeInput(wrapOuter(makeZip()), { contentKey: 'abc' }), {
    code: 'INVALID_CONTENT_KEY',
  });
  assert.throws(() => decodeInput(Buffer.concat([Buffer.from('FXAP'), Buffer.alloc(20)])), {
    code: 'TRUNCATED_FXAP',
  });
});
