// Usage: node scripts/encrypt-me.js <file> <passphrase> <salt>
import { webcrypto } from 'crypto';
import { readFileSync } from 'fs';

const [,, file, passphrase, salt] = process.argv;

if (!file || !passphrase || !salt) {
  console.error('Usage: node scripts/encrypt-me.js <file> <passphrase> <salt>');
  process.exit(1);
}

const { subtle } = webcrypto;
const enc = new TextEncoder();

const payload = readFileSync(file, 'utf8');

const passKey = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
const key = await subtle.deriveKey(
  { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10000, hash: 'SHA-256' },
  passKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);

const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payload)));

const blob = new Uint8Array(iv.length + ciphertext.length);
blob.set(iv);
blob.set(ciphertext, iv.length);

const b64url = btoa(String.fromCharCode(...blob))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');

console.log(b64url);
