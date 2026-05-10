const SEP = '\x1F';
// Type byte — bit 0: 0=public 1=protected  |  bit 1: 0=compressed 1=raw
const TYPE_PUBLIC          = 0x00;
const TYPE_PROTECTED       = 0x01;
const TYPE_PUBLIC_RAW      = 0x02;
const TYPE_PROTECTED_RAW   = 0x03;

// ── Serialization ─────────────────────────────────────────

export function serialize(nodes, title = '') {
  const parts = nodes.map(n => {
    const d = Math.min(9, Math.max(0, n.depth));
    const t = n.type === 'x' ? 'x' : n.type === '-' ? '-' : ' ';
    const label = (n.label || '').replace(/\x1F/g, '');
    return `${d}${t}${label}`;
  });
  // Prepend title token (type 't') when non-empty; strip chars that would
  // break the format
  const clean = (title || '').replace(/[\x1F]/g, '').trim();
  if (clean) parts.unshift(`0t${clean}`);
  return parts.join(SEP);
}

export function deserialize(flat) {
  if (!flat) return { nodes: [], title: '' };
  const tokens = flat.split(SEP);
  let title = '';
  let start = 0;
  // First token is a title marker when its second char is 't'
  if (tokens.length > 0 && tokens[0].length >= 2 && tokens[0][1] === 't') {
    title = tokens[0].slice(2);
    start = 1;
  }
  const nodes = tokens.slice(start).map((token, i) => {
    if (token.length < 2) throw new Error(`Invalid node at index ${i}: "${token}"`);
    const depth = parseInt(token[0], 10);
    const type  = token[1];
    if (!['x', ' ', '-'].includes(type)) throw new Error(`Invalid type "${type}" at index ${i}`);
    return { id: crypto.randomUUID(), depth, type, label: token.slice(2) };
  });
  return { nodes, title };
}

// ── Compression ───────────────────────────────────────────

export async function compress(text) {
  const input = new TextEncoder().encode(text);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks = [];
  writer.write(input);
  writer.close();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

const MAX_DECOMP_BYTES = 5 * 1024 * 1024; // 5 MB — guards against decompression bombs

export async function decompress(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  writer.write(bytes);
  writer.close();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECOMP_BYTES) throw new Error('Decompressed payload exceeds size limit');
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}

// ── Key Derivation ────────────────────────────────────────

export async function deriveKey(passphrase, salt) {
  const raw = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey('raw', raw, { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Encrypt / Decrypt ─────────────────────────────────────

async function aesEncrypt(key, iv, data) {
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return new Uint8Array(ct);
}

async function aesDecrypt(key, iv, data) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new Uint8Array(pt);
}

// ── Base64url ─────────────────────────────────────────────

function toBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Adaptive payload: try compress, keep shorter ──────────

async function _bestPayload(flat, protectedBit) {
  const rawBytes   = new TextEncoder().encode(flat);
  const compressed = await compress(flat);
  if (compressed.length < rawBytes.length) {
    return { payload: compressed, flag: protectedBit };           // compressed
  }
  return { payload: rawBytes, flag: protectedBit | 0x02 };        // raw
}

// ── Public Pipeline ───────────────────────────────────────

export async function encodePublic(nodes, title = '') {
  const flat = serialize(nodes, title);
  const { payload, flag } = await _bestPayload(flat, 0x00);
  const packed = new Uint8Array(1 + payload.length);
  packed[0] = flag;
  packed.set(payload, 1);
  return toBase64url(packed);
}

// ── Protected Pipeline ────────────────────────────────────

export async function encodeProtected(nodes, passphrase, title = '') {
  const flat = serialize(nodes, title);
  const { payload, flag } = await _bestPayload(flat, 0x01);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const ct   = await aesEncrypt(key, iv, payload);
  // layout: type(1) + salt(16) + iv(12) + ct+tag
  const packed = new Uint8Array(1 + 16 + 12 + ct.length);
  packed[0] = flag;
  packed.set(salt, 1);
  packed.set(iv, 17);
  packed.set(ct, 29);
  return toBase64url(packed);
}

// ── Decode (both paths) ───────────────────────────────────

export async function decodeFromHash(hash, passphrase) {
  const packed      = fromBase64url(hash);
  const type        = packed[0];
  const isProtected = (type & 0x01) === 1;
  const isRaw       = (type & 0x02) === 2;

  async function inflate(bytes) {
    return isRaw ? new TextDecoder().decode(bytes) : decompress(bytes);
  }

  if (!isProtected) {
    const { nodes, title } = deserialize(await inflate(packed.slice(1)));
    return { nodes, title, isPublic: true };
  }

  if (!passphrase) throw new Error('Passphrase required');
  const salt      = packed.slice(1, 17);
  const iv        = packed.slice(17, 29);
  const ct        = packed.slice(29);
  const key       = await deriveKey(passphrase, salt);
  const decrypted = await aesDecrypt(key, iv, ct);
  const { nodes, title } = deserialize(await inflate(decrypted));
  return { nodes, title, isPublic: false };
}

export { TYPE_PUBLIC, TYPE_PROTECTED, TYPE_PUBLIC_RAW, TYPE_PROTECTED_RAW };
