import { safeRelativePath } from './local-assets.ts';

export type PreviewEntry = {
  sourceSize: [number, number];
  displayedSize: [number, number];
  frames: number;
  variants: Record<'640' | '1600', { path: string; size: [number, number] }>;
};
export type PreviewIndex = Record<string, PreviewEntry>;

/** Only a matching packaged GEDCOM can select this package's derivatives.
 * Imported families never use the hosted family's preview index. */
export function readPreviewIndex(
  payload: unknown,
  gedcomSha256: string,
): PreviewIndex {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return {};
  const data = payload as Record<string, unknown>;
  if (
    data.schema !== 1 ||
    data.gedcomSha256 !== gedcomSha256 ||
    !data.files ||
    typeof data.files !== 'object' ||
    Array.isArray(data.files)
  )
    return {};
  const output: PreviewIndex = {};
  const dimensions = (size: unknown): size is [number, number] =>
    Array.isArray(size) &&
    size.length === 2 &&
    size.every((n) => Number.isInteger(n) && n > 0);
  for (const [path, value] of Object.entries(data.files)) {
    if (
      safeRelativePath(path) !== path ||
      !path.startsWith('images/') ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    )
      continue;
    const record = value as Record<string, unknown>;
    if (
      !dimensions(record.sourceSize) ||
      !dimensions(record.displayedSize) ||
      !Number.isInteger(record.frames) ||
      Number(record.frames) < 1 ||
      typeof record.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(record.sourceSha256) ||
      !record.variants ||
      typeof record.variants !== 'object' ||
      Array.isArray(record.variants)
    )
      continue;
    const variants = record.variants as Record<string, unknown>;
    const displayedSize = record.displayedSize;
    const accepted: Partial<PreviewEntry['variants']> = {};
    for (const key of ['640', '1600'] as const) {
      const candidate = variants[key];
      if (!candidate || typeof candidate !== 'object') continue;
      const variant = candidate as Record<string, unknown>;
      if (
        typeof variant.path !== 'string' ||
        !new RegExp(
          `^previews/[a-f0-9]{16}-${record.sourceSha256}/${key}\\.webp$`,
        ).test(variant.path) ||
        !dimensions(variant.size) ||
        Math.max(...variant.size) !==
          Math.min(Number(key), Math.max(...record.displayedSize)) ||
        variant.size.some((n, i) => n > displayedSize[i]) ||
        Math.abs(
          variant.size[0] * record.displayedSize[1] -
            variant.size[1] * record.displayedSize[0],
        ) > Math.max(...record.displayedSize)
      )
        continue;
      accepted[key] = { path: variant.path, size: variant.size };
    }
    if (accepted['640'] && accepted['1600'])
      output[path] = {
        sourceSize: record.sourceSize,
        displayedSize: record.displayedSize,
        frames: Number(record.frames),
        variants: { '640': accepted['640'], '1600': accepted['1600'] },
      };
  }
  return output;
}
/** A file's SHA-256 as hex. Browsers offer crypto.subtle only on HTTPS and
 * localhost; over plain HTTP, such as a site on a home network, the same
 * hash is worked out here instead. */
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = globalThis.crypto?.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    : sha256Bytes(new Uint8Array(bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const K = Uint32Array.from(
  // The first 32 bits of the fractional parts of the cube roots of the first
  // 64 primes (FIPS 180-4).
  '428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'
    .split(' ')
    .map((word) => parseInt(word, 16)),
);

/** SHA-256 (FIPS 180-4) without Web Crypto. */
export function sha256Bytes(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 =
        rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[i] +
          w[i]) >>>
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = (h[i] + value) >>> 0;
    });
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((value, i) => outView.setUint32(i * 4, value));
  return out;
}
