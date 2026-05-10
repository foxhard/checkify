import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serialize, deserialize,
  compress, decompress,
  encodePublic, encodeProtected,
  decodeFromHash,
  TYPE_PUBLIC, TYPE_PUBLIC_RAW,
} from '../assets/js/codec.js';

// ── Fixtures ──────────────────────────────────────────────

const NODES = [
  { id: '1', depth: 0, type: '-', label: 'Groceries' },
  { id: '2', depth: 1, type: 'x', label: 'Apples' },
  { id: '3', depth: 1, type: ' ', label: 'Oranges' },
];
const TITLE = 'Weekend List';

// Decode the first byte of a base64url hash
function firstByte(hash) {
  const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return Buffer.from(padded, 'base64')[0];
}

// Flip one byte at a given offset in a base64url hash
function corruptHash(hash, offset = 30) {
  const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const bytes = Buffer.from(padded, 'base64');
  bytes[offset] = bytes[offset] ^ 0xff;
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Suite 1: serialize / deserialize ─────────────────────

describe('serialize / deserialize', () => {
  it('empty nodes and no title round-trips to empty', () => {
    const { nodes, title } = deserialize(serialize([], ''));
    assert.equal(nodes.length, 0);
    assert.equal(title, '');
  });

  it('preserves node fields through round-trip', () => {
    const { nodes, title } = deserialize(serialize(NODES, TITLE));
    assert.equal(title, TITLE);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].depth, 0);
    assert.equal(nodes[0].type, '-');
    assert.equal(nodes[0].label, 'Groceries');
    assert.equal(nodes[1].depth, 1);
    assert.equal(nodes[1].type, 'x');
    assert.equal(nodes[1].label, 'Apples');
    assert.equal(nodes[2].type, ' ');
    assert.equal(nodes[2].label, 'Oranges');
  });

  it('extracts title from the title token — does not include it in nodes', () => {
    const flat = serialize(NODES, TITLE);
    const { nodes, title } = deserialize(flat);
    assert.equal(title, TITLE);
    assert.equal(nodes.length, NODES.length);
    // No node should carry the title text as a label
    assert.ok(!nodes.some(n => n.label === TITLE));
  });

  it('strips \\x1F from labels to avoid breaking deserialization', () => {
    const nodes = [{ id: '1', depth: 0, type: ' ', label: 'Hello\x1FWorld' }];
    const { nodes: out } = deserialize(serialize(nodes, ''));
    assert.equal(out[0].label, 'HelloWorld');
  });

  it('clamps depth > 9 to 9', () => {
    const nodes = [{ id: '1', depth: 10, type: ' ', label: 'Deep' }];
    const { nodes: out } = deserialize(serialize(nodes, ''));
    assert.equal(out[0].depth, 9);
  });

  it('preserves all three node types: x, space, -', () => {
    const nodes = [
      { id: '1', depth: 0, type: 'x', label: 'done' },
      { id: '2', depth: 0, type: ' ', label: 'todo' },
      { id: '3', depth: 0, type: '-', label: 'section' },
    ];
    const { nodes: out } = deserialize(serialize(nodes, ''));
    assert.equal(out[0].type, 'x');
    assert.equal(out[1].type, ' ');
    assert.equal(out[2].type, '-');
  });

  it('preserves empty string labels', () => {
    const nodes = [{ id: '1', depth: 0, type: ' ', label: '' }];
    const { nodes: out } = deserialize(serialize(nodes, ''));
    assert.equal(out[0].label, '');
  });

  it('throws on token that is too short (< 2 chars)', () => {
    assert.throws(() => deserialize('x'), /Invalid node/);
  });

  it('throws on invalid type character', () => {
    assert.throws(() => deserialize('0zLabel'), /Invalid type/);
  });
});

// ── Suite 2: compress / decompress ───────────────────────

describe('compress / decompress', () => {
  it('round-trips a short string', async () => {
    const text = 'hi';
    assert.equal(await decompress(await compress(text)), text);
  });

  it('round-trips a long string', async () => {
    const text = 'item number '.repeat(200);
    assert.equal(await decompress(await compress(text)), text);
  });

  it('round-trips unicode (emoji + accented + CJK)', async () => {
    const text = '🎉 Émoji & Ünïcödé 中文 日本語';
    assert.equal(await decompress(await compress(text)), text);
  });

  it('compression reduces size for repetitive content', async () => {
    const text = 'item number '.repeat(200);
    const raw = new TextEncoder().encode(text);
    const compressed = await compress(text);
    assert.ok(
      compressed.length < raw.length,
      `expected compressed (${compressed.length}B) < raw (${raw.length}B)`
    );
  });
});

// ── Suite 3: encodePublic / decodeFromHash ────────────────

describe('encodePublic / decodeFromHash — public path', () => {
  it('full round-trip preserves all nodes and title', async () => {
    const hash = await encodePublic(NODES, TITLE);
    const { nodes, title, isPublic } = await decodeFromHash(hash, null);
    assert.equal(isPublic, true);
    assert.equal(title, TITLE);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].label, 'Groceries');
    assert.equal(nodes[1].type, 'x');
    assert.equal(nodes[2].label, 'Oranges');
  });

  it('type byte bit0 = 0 (public)', async () => {
    const hash = await encodePublic(NODES, TITLE);
    assert.equal(firstByte(hash) & 0x01, 0);
  });

  it('short payload uses raw path (type byte bit1 = 1)', async () => {
    const shortNodes = [{ id: '1', depth: 0, type: ' ', label: 'Hi' }];
    const hash = await encodePublic(shortNodes, 'T');
    assert.equal(firstByte(hash) & 0x02, 0x02, 'expected raw flag for short payload');
  });

  it('long payload uses compressed path (type byte bit1 = 0)', async () => {
    const longNodes = Array.from({ length: 60 }, (_, i) => ({
      id: String(i), depth: 0, type: ' ', label: `Item number ${i} with some descriptive text`,
    }));
    const hash = await encodePublic(longNodes, 'Long List of Items');
    assert.equal(firstByte(hash) & 0x02, 0, 'expected compressed flag for long payload');
  });

  it('decodes without a passphrase', async () => {
    const hash = await encodePublic(NODES, TITLE);
    await assert.doesNotReject(() => decodeFromHash(hash, null));
  });
});

// ── Suite 4: encodeProtected / decodeFromHash ─────────────

describe('encodeProtected / decodeFromHash — protected path', () => {
  it('full round-trip with correct passphrase', async () => {
    const hash = await encodeProtected(NODES, 'mypassword', TITLE);
    const { nodes, title, isPublic } = await decodeFromHash(hash, 'mypassword');
    assert.equal(isPublic, false);
    assert.equal(title, TITLE);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[1].label, 'Apples');
  });

  it('type byte bit0 = 1 (protected)', async () => {
    const hash = await encodeProtected(NODES, 'pass', TITLE);
    assert.equal(firstByte(hash) & 0x01, 1);
  });

  it('produces different hashes on each call (random salt + IV)', async () => {
    const h1 = await encodeProtected(NODES, 'pass', TITLE);
    const h2 = await encodeProtected(NODES, 'pass', TITLE);
    assert.notEqual(h1, h2);
  });

  it('throws on wrong passphrase', async () => {
    const hash = await encodeProtected(NODES, 'correct', TITLE);
    await assert.rejects(() => decodeFromHash(hash, 'wrong'));
  });

  it('throws "Passphrase required" when passphrase is null', async () => {
    const hash = await encodeProtected(NODES, 'pass', TITLE);
    await assert.rejects(
      () => decodeFromHash(hash, null),
      /Passphrase required/
    );
  });
});

// ── Suite 5: edge cases ───────────────────────────────────

describe('edge cases', () => {
  it('round-trips a 500-character label through the full public pipeline', async () => {
    const longLabel = 'a'.repeat(500);
    const nodes = [{ id: '1', depth: 0, type: ' ', label: longLabel }];
    const hash = await encodePublic(nodes, 'Long Label Test');
    const { nodes: out } = await decodeFromHash(hash, null);
    assert.equal(out[0].label, longLabel);
  });

  it('round-trips a unicode title', async () => {
    const unicodeTitle = 'título con Ñ 🔒 中文';
    const hash = await encodePublic(NODES, unicodeTitle);
    const { title } = await decodeFromHash(hash, null);
    assert.equal(title, unicodeTitle);
  });

  it('throws on a completely garbled hash', async () => {
    // Not valid base64url — should throw at the atob / decode stage
    await assert.rejects(() => decodeFromHash('!!!!not-valid-base64url!!!!', null));
  });

  it('treats 0xFF as protected (bit0=1) and throws Passphrase required', async () => {
    const bytes = new Uint8Array([0xff, 1, 2, 3, 4]);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const hash = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    await assert.rejects(() => decodeFromHash(hash, null), /Passphrase required/);
  });

  it('throws when ciphertext is corrupted (flipped byte)', async () => {
    const hash = await encodeProtected(NODES, 'pass', TITLE);
    const bad  = corruptHash(hash);
    await assert.rejects(() => decodeFromHash(bad, 'pass'));
  });

  it('round-trips nodes with depth 0 through 9', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), depth: i, type: ' ', label: `Level ${i}`,
    }));
    const hash = await encodePublic(nodes, 'Depth Test');
    const { nodes: out } = await decodeFromHash(hash, null);
    for (let i = 0; i < 10; i++) {
      assert.equal(out[i].depth, Math.min(i, 9));
      assert.equal(out[i].label, `Level ${i}`);
    }
  });
});
