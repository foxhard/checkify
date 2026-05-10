import { test as base, expect } from '@playwright/test';

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      if (!crypto.randomUUID) {
        crypto.randomUUID = () => {
          const b = new Uint8Array(16);
          crypto.getRandomValues(b);
          b[6] = (b[6] & 0x0f) | 0x40;
          b[8] = (b[8] & 0x3f) | 0x80;
          return [...b].map((v, i) =>
            ([4, 6, 8, 10].includes(i) ? '-' : '') + v.toString(16).padStart(2, '0')
          ).join('');
        };
      }

      // Stub crypto.subtle for non-secure HTTP contexts (e.g. http://jekyll:4000 in Docker).
      // Uses XOR + a key-derived tag so wrong passphrases throw OperationError, matching
      // real AES-GCM behaviour. Encode and decode are self-consistent for the same passphrase.
      if (!crypto.subtle) {
        const _concat = (...arrays) => {
          const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
          let off = 0;
          for (const a of arrays) { out.set(a, off); off += a.length; }
          return out;
        };
        crypto.subtle = {
          importKey: async (_fmt, keyData) =>
            ({ _raw: new Uint8Array(keyData) }),
          deriveKey: async (alg, baseKey) =>
            ({ _key: _concat(baseKey._raw, new Uint8Array(alg.salt)) }),
          encrypt: async (_alg, key, data) => {
            const d = new Uint8Array(data), k = key._key;
            const out = new Uint8Array(d.length + 16);
            for (let i = 0; i < d.length; i++) out[i] = d[i] ^ k[i % k.length];
            // 16-byte tag derived from key + plaintext length
            for (let i = 0; i < 16; i++) out[d.length + i] = k[i % k.length] ^ (d.length & 0xff);
            return out.buffer;
          },
          decrypt: async (_alg, key, data) => {
            const d = new Uint8Array(data);
            const ct = d.slice(0, -16), tag = d.slice(-16);
            const k = key._key;
            for (let i = 0; i < 16; i++) {
              if (tag[i] !== (k[i % k.length] ^ (ct.length & 0xff)))
                throw new DOMException('The operation failed for an operation-specific reason', 'OperationError');
            }
            const out = new Uint8Array(ct.length);
            for (let i = 0; i < ct.length; i++) out[i] = ct[i] ^ k[i % k.length];
            return out.buffer;
          },
        };
      }
    });
    await use(page);
  },
});
