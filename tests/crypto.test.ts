import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptText, encryptText, randomToken, sha256Hex, timingSafeEqual, toBase64Url } from '../src/lib/crypto.ts';

const key = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

test('chiffrement : aller-retour correct', async () => {
  const enc = await encryptText('jeton-secret', key);
  assert.ok(enc.startsWith('v1.'));
  assert.ok(!enc.includes('jeton-secret'));
  assert.equal(await decryptText(enc, key), 'jeton-secret');
});

test('chiffrement : deux chiffrements du même texte diffèrent (IV aléatoire)', async () => {
  assert.notEqual(await encryptText('a', key), await encryptText('a', key));
});

test('chiffrement : mauvaise clé refusée', async () => {
  const enc = await encryptText('x', key);
  const other = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await assert.rejects(decryptText(enc, other));
});

test('chiffrement : données altérées refusées', async () => {
  const enc = await encryptText('x', key);
  const parts = enc.split('.');
  parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
  await assert.rejects(decryptText(parts.join('.'), key));
});

test('chiffrement : clé de mauvaise taille refusée', async () => {
  await assert.rejects(encryptText('x', toBase64Url(new Uint8Array(16))));
});

test('jetons aléatoires : longueur et unicité', () => {
  const a = randomToken();
  assert.ok(a.length >= 43);
  assert.notEqual(a, randomToken());
});

test('sha256 : valeur connue', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('comparaison en temps constant', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});
