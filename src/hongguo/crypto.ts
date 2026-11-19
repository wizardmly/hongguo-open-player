// SPDX-License-Identifier: GPL-3.0-only
import { Buffer } from "buffer";
import nodeCrypto from "crypto";

function toBuf(input: Uint8Array | string): Buffer {
  if (typeof input === "string") return Buffer.from(input, "utf8");
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

export function readU16BE(buf: Uint8Array, off = 0): number {
  return ((buf[off] << 8) | buf[off + 1]) >>> 0;
}

export function readU32BE(buf: Uint8Array, off = 0): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

export function readU32LE(buf: Uint8Array, off = 0): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

export function readI32LE(buf: Uint8Array, off = 0): number {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
}

export function writeU32BE(buf: Uint8Array, value: number, off = 0): void {
  const v = value >>> 0;
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

export function writeU32LE(buf: Uint8Array, value: number, off = 0): void {
  const v = value >>> 0;
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

export function readU64BE(buf: Uint8Array, off = 0): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[off + i]);
  return v;
}

export function readU64LE(buf: Uint8Array, off = 0): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(buf[off + i]);
  return v;
}

export function writeU64BE(buf: Uint8Array, value: bigint, off = 0): void {
  let v = BigInt.asUintN(64, value);
  for (let i = 7; i >= 0; i--) {
    buf[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

export function writeU64LE(buf: Uint8Array, value: bigint, off = 0): void {
  let v = BigInt.asUintN(64, value);
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function hasFourcc(buf: Uint8Array, fourcc: string): boolean {
  const c0 = fourcc.charCodeAt(0);
  const c1 = fourcc.charCodeAt(1);
  const c2 = fourcc.charCodeAt(2);
  const c3 = fourcc.charCodeAt(3);
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === c0 && buf[i + 1] === c1 && buf[i + 2] === c2 && buf[i + 3] === c3) return true;
  }
  return false;
}

export function md5(input: Uint8Array | string): Buffer {
  return nodeCrypto.createHash("md5").update(toBuf(input)).digest();
}

export function md5Hex(input: Uint8Array | string): string {
  return nodeCrypto.createHash("md5").update(toBuf(input)).digest("hex");
}

export function md5HexUpper(input: Uint8Array | string): string {
  return md5Hex(input).toUpperCase();
}

export function sha512(input: Uint8Array | string): Buffer {
  return nodeCrypto.createHash("sha512").update(toBuf(input)).digest();
}

/** SM3 (GB/T 32905), pure TypeScript implementation for quick cross-platform protocol signing. */
export function sm3(input: Uint8Array | string): Buffer {
  const source = toBuf(input);
  const data = Buffer.alloc(Math.ceil((source.length + 9) / 64) * 64);
  source.copy(data);
  data[source.length] = 0x80;
  writeU64BE(data, BigInt(source.length) * 8n, data.length - 8);
  const state = new Uint32Array([
    0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
    0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
  ]);
  const words = new Uint32Array(68);
  const rotate = (x: number, n: number) => ((x << (n & 31)) | (x >>> ((32 - n) & 31))) >>> 0;
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = readU32BE(data, offset + i * 4);
    for (let i = 16; i < 68; i++) {
      const x = words[i - 16] ^ words[i - 9] ^ rotate(words[i - 3], 15);
      words[i] = x ^ rotate(x, 15) ^ rotate(x, 23) ^ rotate(words[i - 13], 7) ^ words[i - 6];
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const a12 = rotate(a, 12);
      const s1 = rotate((a12 + e + rotate(i < 16 ? 0x79cc4519 : 0x7a879d8a, i)) >>> 0, 7);
      const s2 = s1 ^ a12;
      const ff = i < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c);
      const gg = i < 16 ? e ^ f ^ g : (e & f) | (~e & g);
      const t1 = (ff + d + s2 + (words[i] ^ words[i + 4])) >>> 0;
      const t2 = (gg + h + s1 + words[i]) >>> 0;
      d = c;
      c = rotate(b, 9);
      b = a;
      a = t1;
      h = g;
      g = rotate(f, 19);
      f = e;
      e = (t2 ^ rotate(t2, 9) ^ rotate(t2, 17)) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) state[i] ^= next[i];
  }
  const digest = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) writeU32BE(digest, state[i], i * 4);
  return digest;
}

// ── FIPS-197 AES-128-CBC (no padding) for protocol header encryption ─────────

const AES_SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const AES_INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) AES_INV_SBOX[AES_SBOX[i]] = i;

const AES_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function expandAes128Key(key: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error(`AES-128 requires 16-byte key, got ${key.length}`);
  const rk = new Uint8Array(176);
  rk.set(key.subarray(0, 16), 0);
  for (let i = 4; i < 44; i++) {
    let t0 = rk[(i - 1) * 4];
    let t1 = rk[(i - 1) * 4 + 1];
    let t2 = rk[(i - 1) * 4 + 2];
    let t3 = rk[(i - 1) * 4 + 3];
    if ((i & 3) === 0) {
      const n0 = AES_SBOX[t1] ^ AES_RCON[(i >> 2) - 1];
      t1 = AES_SBOX[t2];
      t2 = AES_SBOX[t3];
      t3 = AES_SBOX[t0];
      t0 = n0;
    }
    rk[i * 4] = rk[(i - 4) * 4] ^ t0;
    rk[i * 4 + 1] = rk[(i - 4) * 4 + 1] ^ t1;
    rk[i * 4 + 2] = rk[(i - 4) * 4 + 2] ^ t2;
    rk[i * 4 + 3] = rk[(i - 4) * 4 + 3] ^ t3;
  }
  return rk;
}

function gfMul(a: number, b: number): number {
  let p = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) p ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>= 1;
  }
  return p;
}

function aesAddRoundKey(s: Uint8Array, rk: Uint8Array, round: number): void {
  const off = round * 16;
  for (let i = 0; i < 16; i++) s[i] ^= rk[off + i];
}

function aesEncryptBlockInto(block: Uint8Array, rk: Uint8Array): void {
  aesAddRoundKey(block, rk, 0);
  for (let round = 1; round <= 10; round++) {
    for (let i = 0; i < 16; i++) block[i] = AES_SBOX[block[i]];
    // ShiftRows (column-major layout: index = col*4 + row)
    let tmp = block[1];
    block[1] = block[5];
    block[5] = block[9];
    block[9] = block[13];
    block[13] = tmp;

    tmp = block[2];
    block[2] = block[10];
    block[10] = tmp;
    tmp = block[6];
    block[6] = block[14];
    block[14] = tmp;

    tmp = block[15];
    block[15] = block[11];
    block[11] = block[7];
    block[7] = block[3];
    block[3] = tmp;

    if (round < 10) {
      for (let c = 0; c < 4; c++) {
        const i = c * 4;
        const s0 = block[i];
        const s1 = block[i + 1];
        const s2 = block[i + 2];
        const s3 = block[i + 3];
        const t = s0 ^ s1 ^ s2 ^ s3;
        const xt = (x: number) => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
        block[i] = s0 ^ t ^ xt(s0 ^ s1);
        block[i + 1] = s1 ^ t ^ xt(s1 ^ s2);
        block[i + 2] = s2 ^ t ^ xt(s2 ^ s3);
        block[i + 3] = s3 ^ t ^ xt(s3 ^ s0);
      }
    }
    aesAddRoundKey(block, rk, round);
  }
}

function aesDecryptBlockInto(block: Uint8Array, rk: Uint8Array): void {
  aesAddRoundKey(block, rk, 10);
  for (let round = 9; round >= 0; round--) {
    // InvShiftRows
    let tmp = block[13];
    block[13] = block[9];
    block[9] = block[5];
    block[5] = block[1];
    block[1] = tmp;

    tmp = block[2];
    block[2] = block[10];
    block[10] = tmp;
    tmp = block[6];
    block[6] = block[14];
    block[14] = tmp;

    tmp = block[3];
    block[3] = block[7];
    block[7] = block[11];
    block[11] = block[15];
    block[15] = tmp;

    for (let i = 0; i < 16; i++) block[i] = AES_INV_SBOX[block[i]];
    aesAddRoundKey(block, rk, round);

    if (round > 0) {
      for (let c = 0; c < 4; c++) {
        const i = c * 4;
        const s0 = block[i];
        const s1 = block[i + 1];
        const s2 = block[i + 2];
        const s3 = block[i + 3];
        block[i] = gfMul(0x0e, s0) ^ gfMul(0x0b, s1) ^ gfMul(0x0d, s2) ^ gfMul(0x09, s3);
        block[i + 1] = gfMul(0x09, s0) ^ gfMul(0x0e, s1) ^ gfMul(0x0b, s2) ^ gfMul(0x0d, s3);
        block[i + 2] = gfMul(0x0d, s0) ^ gfMul(0x09, s1) ^ gfMul(0x0e, s2) ^ gfMul(0x0b, s3);
        block[i + 3] = gfMul(0x0b, s0) ^ gfMul(0x0d, s1) ^ gfMul(0x09, s2) ^ gfMul(0x0e, s3);
      }
    }
  }
}

export function pkcs7Pad16(data: Uint8Array): Buffer {
  const padding = 16 - (data.length % 16);
  return Buffer.concat([Buffer.from(data), Buffer.alloc(padding, padding)]);
}

export function aes128CbcEncryptNoPad(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer {
  if (iv.length !== 16) throw new Error(`AES-128-CBC requires 16-byte IV, got ${iv.length}`);
  if (data.length % 16 !== 0) throw new Error(`AES-128-CBC (no padding) requires multiple of 16 bytes, got ${data.length}`);
  const rk = expandAes128Key(key);
  const out = Buffer.alloc(data.length);
  const block = new Uint8Array(16);
  let prev: Uint8Array = iv;
  for (let off = 0; off < data.length; off += 16) {
    for (let i = 0; i < 16; i++) block[i] = data[off + i] ^ prev[i];
    aesEncryptBlockInto(block, rk);
    out.set(block, off);
    prev = out.subarray(off, off + 16);
  }
  return out;
}

export function aes128CbcDecryptNoPad(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer {
  if (iv.length !== 16) throw new Error(`AES-128-CBC requires 16-byte IV, got ${iv.length}`);
  if (data.length % 16 !== 0) throw new Error(`AES-128-CBC (no padding) requires multiple of 16 bytes, got ${data.length}`);
  const rk = expandAes128Key(key);
  const out = Buffer.alloc(data.length);
  const block = new Uint8Array(16);
  let prev: Uint8Array = iv;
  for (let off = 0; off < data.length; off += 16) {
    block.set(data.subarray(off, off + 16));
    aesDecryptBlockInto(block, rk);
    for (let i = 0; i < 16; i++) out[off + i] = block[i] ^ prev[i];
    prev = data.subarray(off, off + 16);
  }
  return out;
}

// ── MP4 CENC-AES-CTR Decryption & Container Rebuild ──────────────────────────

function avBase64Decode(s: string): Buffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table: Record<number, number> = {};
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = i;
  const dst: number[] = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const vals: number[] = [];
    let ok = true;
    for (let j = 0; j < 4; j++) {
      const c = s.charCodeAt(i + j);
      if (c in table) {
        vals.push(table[c]);
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) {
      let v = 0;
      for (let j2 = 0; j2 < vals.length; j2++) {
        v = (v << 6) | vals[j2];
      }
      if (vals.length === 3) {
        dst.push((v >> 10) & 0xff);
        dst.push((v >> 2) & 0xff);
      } else if (vals.length === 2) {
        dst.push((v >> 4) & 0xff);
      }
      break;
    }
    const v = (vals[0] << 18) | (vals[1] << 12) | (vals[2] << 6) | vals[3];
    dst.push((v >> 16) & 0xff);
    dst.push((v >> 8) & 0xff);
    dst.push(v & 0xff);
    i += 4;
  }
  return Buffer.from(dst);
}

/** Legacy spade_a -> 16-byte AES Key decoder. */
export function deriveKey(spadeA: string | null | undefined): Buffer | null {
  if (!spadeA) return null;
  const buf = avBase64Decode(spadeA);
  const L = buf.length;
  if (L < 3) return null;

  const key0 = buf[0] ^ buf[1] ^ buf[2];
  const x27 = key0 - 0x30;
  const w22 = L - key0 + 0x2f;
  if (x27 < 2 || w22 < 2 || w22 > L - 1) return null;

  const x21 = Buffer.from(buf.subarray(1, 1 + w22));
  let w11 = 0x55;
  let w12 = 0xfa;
  const w10 = 0xeb;
  for (let i = 0; i < x21.length; i++) {
    const w13 = x21[i];
    const pc = i.toString(2).split("1").length - 1;
    const w14 = (i & 1) === 0 ? w12 : w11;
    if ((i & 1) === 1) {
      w11 = w13;
    } else {
      w12 = w13;
    }
    const w13Xor = w14 ^ x21[i];
    const w14Sub = w10 - pc;
    x21[i] = (w14Sub + w13Xor) & 0xff;
  }

  const c0 = x21[0];
  let hval = 0;
  if (0x30 <= c0 && c0 <= 0x39) {
    hval = c0 - 0x30;
  } else if (0x61 <= c0 && c0 <= 0x7a) {
    hval = c0 - 0x57;
  } else {
    return null;
  }

  const w9 = w22 - hval;
  if (w9 < 2) return null;

  const strA = x21.subarray(1, 1 + w9 - 1).toString("ascii");
  if (strA.length !== 32) return null;

  try {
    return Buffer.from(strA, "hex");
  } catch {
    return null;
  }
}

interface Mp4Box {
  typ: string;
  off: number;
  size: number;
  hdr: number;
  children: Mp4Box[] | null;
}

export function parseBoxes(data: Buffer, start: number, end: number, depth = 0): Mp4Box[] {
  if (depth > 32) throw new Error("MP4 box nesting exceeds limit");
  const boxes: Mp4Box[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = readU32BE(data, off);
    const typ = data.subarray(off + 4, off + 8).toString("latin1");
    let hdr = 8;
    if (size === 1) {
      if (off + 16 > end) throw new Error("Truncated MP4 box header");
      size = Number(readU64BE(data, off + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (!Number.isSafeInteger(size) || size < hdr || off + size > end) throw new Error("Invalid MP4 box size");
    let children: Mp4Box[] | null = null;
    if (["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"].includes(typ)) {
      children = parseBoxes(data, off + hdr, off + size, depth + 1);
    }
    boxes.push({ typ, off, size, hdr, children });
    off += size;
  }
  if (off !== end) throw new Error("Truncated MP4 box");
  return boxes;
}

function hasSampleEncryption(boxes: Mp4Box[]): boolean {
  return boxes.some((box) => box.typ === "senc" || (box.children ? hasSampleEncryption(box.children) : false));
}

function rebuildMoov(
  data: Buffer,
  _moovOff: number,
  _moovSize: number,
  top: Mp4Box[],
  order: Mp4Box[] = top,
  relocate?: (offset: number, moovSize: number) => number,
): Buffer {
  const moovBox = top.find((b) => b.typ === "moov");
  if (!moovBox) throw new Error("no moov box");

  function clone(box: Mp4Box): Mp4Box {
    return {
      typ: box.typ,
      off: box.off,
      size: box.size,
      hdr: box.hdr,
      children: box.children ? box.children.map(clone) : null,
    };
  }

  function prune(box: Mp4Box): Mp4Box {
    if (!box.children) return box;
    const keep: Mp4Box[] = [];
    for (const c of box.children) {
      if (["senc", "saio", "saiz", "sgpd", "sbgp"].includes(c.typ)) continue;
      keep.push(prune(c));
    }
    box.children = keep;
    return box;
  }

  const tree = prune(clone(moovBox));

  function* walkChildren(box: Mp4Box): Generator<Mp4Box> {
    for (const c of box.children || []) {
      yield c;
      yield* walkChildren(c);
    }
  }

  const patches: Record<number, Buffer> = {};
  for (const b of walkChildren(tree)) {
    if (b.typ === "stsd") {
      const content = b.off + 8;
      const count = readU32BE(data, content + 4);
      let p = content + 8;
      const entries: Buffer[] = [];
      for (let i = 0; i < count; i++) {
        const esize = readU32BE(data, p);
        const etyp = data.subarray(p + 4, p + 8).toString("latin1");
        if (etyp === "encv" || etyp === "enca") {
          const hdrSize = etyp === "encv" ? 78 : 28;
          const children = parseBoxes(data, p + 8 + hdrSize, p + esize);
          let newType: string | null = null;
          if (etyp === "enca") {
            if (readU16BE(data, p + 16) !== 0) throw new Error("Unsupported audio sample entry version");
            const sinf = children.find((child) => child.typ === "sinf");
            const frma = sinf && parseBoxes(data, sinf.off + sinf.hdr, sinf.off + sinf.size).find((child) => child.typ === "frma");
            newType = frma && frma.size === frma.hdr + 4 ? data.toString("latin1", frma.off + frma.hdr, frma.off + frma.hdr + 4) : null;
            if (!newType || !["mp4a", "ac-3", "ec-3", "Opus", "fLaC"].includes(newType)) {
              throw new Error("Unsupported protected audio codec");
            }
          }
          if (etyp === "encv") {
            const sinf = children.find((child) => child.typ === "sinf");
            const frma = sinf && parseBoxes(data, sinf.off + sinf.hdr, sinf.off + sinf.size).find((child) => child.typ === "frma");
            const original = frma && frma.size === frma.hdr + 4
              ? data.toString("latin1", frma.off + frma.hdr, frma.off + frma.hdr + 4)
              : null;
            const avc = children.some((child) => child.typ === "avcC");
            const hevc = children.some((child) => child.typ === "hvcC");
            newType = original || (avc && !hevc ? "avc1" : hevc && !avc ? "hvc1" : null);
            if (
              !newType ||
              !["avc1", "avc3", "hvc1", "hev1"].includes(newType) ||
              (newType.startsWith("avc") ? !avc || hevc : !hevc || avc)
            ) {
              throw new Error("无法确定加密视频的原始编码（codec），请更换片源重试。");
            }
          }
          const entry = Buffer.alloc(8 + hdrSize);
          writeU32BE(entry, 0, 0);
          entry.write(newType!, 4, 4, "latin1");
          data.copy(entry, 8, p + 8, p + 8 + hdrSize);

          const entryExtra = Buffer.concat(
            children
              .filter((child) => child.typ !== "sinf")
              .map((child) => data.subarray(child.off, child.off + child.size)),
          );
          const fullEntry = Buffer.concat([entry, entryExtra]);
          writeU32BE(fullEntry, fullEntry.length, 0);
          entries.push(fullEntry);
        } else {
          entries.push(data.subarray(p, p + esize));
        }
        p += esize;
      }
      const stsdHdr = Buffer.alloc(16);
      data.copy(stsdHdr, 0, b.off, content + 8);
      writeU32BE(stsdHdr, entries.length, 12);
      const fullStsd = Buffer.concat([stsdHdr, ...entries]);
      writeU32BE(fullStsd, fullStsd.length, 0);
      patches[b.off] = fullStsd;
    }
  }

  function serialize(box: Mp4Box): Buffer {
    if (!box.children) {
      return patches[box.off] || data.subarray(box.off, box.off + box.size);
    }
    const body = Buffer.concat(box.children.map(serialize));
    const hdrb = Buffer.alloc(box.hdr);
    data.copy(hdrb, 0, box.off, box.off + box.hdr);
    if (box.hdr === 8) {
      writeU32BE(hdrb, 8 + body.length, 0);
    } else {
      writeU32BE(hdrb, 1, 0);
      writeU64BE(hdrb, BigInt(16 + body.length), 8);
    }
    return Buffer.concat([hdrb, body]);
  }

  const first = serialize(tree);
  const destinations = new Map<number, number>();
  let destination = 0;
  for (const box of order) {
    destinations.set(box.off, destination);
    destination += box.typ === "moov" ? first.length : box.size;
  }
  for (const b of walkChildren(tree)) {
    if (b.typ === "stco" || b.typ === "co64") {
      const count = readU32BE(data, b.off + b.hdr + 4);
      const stride = b.typ === "co64" ? 8 : 4;
      if (b.hdr + 8 + count * stride > b.size) throw new Error("Invalid MP4 chunk table");
      for (let i = 0; i < count; i++) {
        const position = b.off + b.hdr + 8 + i * stride;
        const old = stride === 8 ? Number(readU64BE(data, position)) : readU32BE(data, position);
        if (relocate) {
          const updated = relocate(old, first.length);
          if (stride === 8) writeU64BE(data, BigInt(updated), position);
          else writeU32BE(data, updated, position);
          continue;
        }
        const source = top.find((box) => old >= box.off && old < box.off + box.size);
        if (!Number.isSafeInteger(old) || !source) throw new Error("Invalid MP4 chunk offset");
        const updated = old + destinations.get(source.off)! - source.off;
        if (stride === 8) writeU64BE(data, BigInt(updated), position);
        else writeU32BE(data, updated, position);
      }
    }
  }

  return serialize(tree);
}

interface TrackSampleInfo {
  sizes: number[];
  offs: number[];
  ivs: Buffer[];
  stco: Mp4Box;
  encrypted: boolean;
}

function mp4TrackInfo(data: Buffer, top: Mp4Box[]): TrackSampleInfo[] {
  const getBox = (boxes: Mp4Box[] | null, type: string) => (boxes || []).find((box) => box.typ === type);
  function* walkBoxes(boxes: Mp4Box[]): Generator<Mp4Box> {
    for (const box of boxes) {
      if (box.children) yield* walkBoxes(box.children);
      yield box;
    }
  }
  if (top.some((box) => box.typ === "moof")) throw new Error("Fragmented MP4 is not supported");
  const stbls = Array.from(walkBoxes(top)).filter((b) => b.typ === "stbl");
  const trackInfo: TrackSampleInfo[] = [];
  let sampleBudget = 0;
  for (const stbl of stbls) {
    const stsz = getBox(stbl.children, "stsz");
    const stco = getBox(stbl.children, "stco") || getBox(stbl.children, "co64");
    const stsc = getBox(stbl.children, "stsc");
    const senc = getBox(stbl.children, "senc");
    const stsd = getBox(stbl.children, "stsd");
    let encrypted = false;
    if (stsd) {
      let cursor = stsd.off + 16;
      const count = readU32BE(data, stsd.off + 12);
      for (let i = 0; i < count; i++) {
        if (cursor + 8 > stsd.off + stsd.size) throw new Error("Truncated MP4 sample description");
        const size = readU32BE(data, cursor);
        if (size < 8 || cursor + size > stsd.off + stsd.size) throw new Error("Invalid MP4 sample description");
        const type = data.toString("latin1", cursor + 4, cursor + 8);
        encrypted ||= type === "encv" || type === "enca";
        cursor += size;
      }
    }
    if (encrypted && (!stsz || !stco || !stsc || !senc)) throw new Error("Unsupported encrypted MP4 track layout");
    if (!stsz || !stco || !stsc) continue;

    const ss = readU32BE(data, stsz.off + 12);
    const n = readU32BE(data, stsz.off + 16);
    sampleBudget += n;
    if (sampleBudget > 100000) throw new Error("MP4 sample count exceeds budget");
    if (n > 100000 || (ss === 0 && 20 + n * 4 > stsz.size)) throw new Error("Invalid MP4 sample sizes");
    let sizes: number[] = [];
    if (ss === 0) {
      for (let i = 0; i < n; i++) {
        sizes.push(readU32BE(data, stsz.off + 20 + i * 4));
      }
    } else {
      sizes = new Array(n).fill(ss);
    }

    const nc = readU32BE(data, stco.off + 12);
    const chunkStride = stco.typ === "co64" ? 8 : 4;
    if (16 + nc * chunkStride > stco.size) throw new Error("Invalid MP4 chunk offsets");
    const chunkOffs: number[] = [];
    for (let i = 0; i < nc; i++) {
      const position = stco.off + 16 + i * chunkStride;
      const offset = chunkStride === 8 ? Number(readU64BE(data, position)) : readU32BE(data, position);
      if (!Number.isSafeInteger(offset)) throw new Error("Unsafe MP4 chunk offset");
      chunkOffs.push(offset);
    }

    const ns = readU32BE(data, stsc.off + 12);
    if (16 + ns * 12 > stsc.size) throw new Error("Invalid MP4 sample-to-chunk table");
    const stscTab: [number, number, number][] = [];
    for (let i = 0; i < ns; i++) {
      stscTab.push([
        readU32BE(data, stsc.off + 16 + i * 12),
        readU32BE(data, stsc.off + 20 + i * 12),
        readU32BE(data, stsc.off + 24 + i * 12),
      ]);
    }

    const ivs: Buffer[] = [];
    if (senc) {
      const sc = readU32BE(data, senc.off + 12);
      if (readU32BE(data, senc.off + 8) !== 0 || sc !== n || senc.size !== 16 + sc * 8) {
        throw new Error("Unsupported CENC encryption layout (requires full samples and 8-byte IVs)");
      }
      for (let i = 0; i < sc; i++) {
        ivs.push(data.subarray(senc.off + 16 + i * 8, senc.off + 24 + i * 8));
      }
    }

    if (!senc && (stbl.children || []).some((box) => ["saio", "saiz"].includes(box.typ))) {
      throw new Error("Unsupported external CENC auxiliary data");
    }
    if (n > 0 && (!stscTab.length || stscTab[0][0] !== 1)) throw new Error("Invalid first MP4 chunk");
    for (let i = 0; i < stscTab.length; i++) {
      const [first, samples] = stscTab[i];
      if (first < 1 || first > nc || samples < 1 || samples > n || (i && first <= stscTab[i - 1][0])) {
        throw new Error("Invalid MP4 chunk mapping");
      }
    }
    const chunkSpc: Record<number, number> = {};
    for (let i = 0; i < stscTab.length; i++) {
      const fc = stscTab[i][0];
      const spc = stscTab[i][1];
      const nxt = i + 1 < stscTab.length ? stscTab[i + 1][0] : nc + 1;
      for (let ci = fc - 1; ci < nxt - 1; ci++) {
        chunkSpc[ci] = spc;
      }
    }

    const sampleOffs: number[] = [];
    let si = 0;
    for (let ci = 0; ci < nc; ci++) {
      let off = chunkOffs[ci];
      const spc = chunkSpc[ci] || 1;
      for (let s = 0; s < spc; s++) {
        if (si >= n) break;
        sampleOffs.push(off);
        off += sizes[si];
        si++;
      }
    }

    if (si !== n) throw new Error("MP4 sample-to-chunk count mismatch");
    trackInfo.push({ sizes, offs: sampleOffs, ivs, stco, encrypted });
  }

  return trackInfo;
}

/**
 * Decrypts a full CENC-AES-CTR encrypted MP4 in memory via native WebCrypto (`AES-CTR`)
 * and rewrites `moov` (moving it before `mdat` for instant seek/faststart and removing `sinf`/`senc`).
 */
export async function decryptMp4Buffer(input: Uint8Array, key: Uint8Array | null): Promise<Buffer> {
  const data = Buffer.from(input);
  const total = data.length;
  const top = parseBoxes(data, 0, total);
  const moov = top.find((b) => b.typ === "moov");
  if (!moov) throw new Error("no moov box found in MP4");

  const trackInfo = mp4TrackInfo(data, top);
  const needsDecrypt =
    hasSampleEncryption(top) || trackInfo.some((track) => track.encrypted || track.ivs.length > 0);
  if (needsDecrypt && (!key || key.length !== 16)) {
    throw new Error("Invalid CENC key");
  }

  if (needsDecrypt && key) {
    const rawKey = new Uint8Array(16);
    rawKey.set(key.subarray(0, 16));
    const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, false, ["decrypt"]);
    const iv = new Uint8Array(16);

    for (const ti of trackInfo) {
      for (let i = 0; i < ti.offs.length; i++) {
        const off = ti.offs[i];
        const sz = ti.sizes[i];
        if (off + sz > total) throw new Error("MP4 sample exceeds file bounds");
        if (i < ti.ivs.length && sz > 0) {
          iv.fill(0);
          iv.set(ti.ivs[i].subarray(0, 8), 0);
          const sampleSlice = data.slice(off, off + sz);
          const plain = await crypto.subtle.decrypt(
            { name: "AES-CTR", counter: iv, length: 64 },
            cryptoKey,
            sampleSlice,
          );
          data.set(new Uint8Array(plain), off);
        }
      }
    }
  }

  const order = [...top];
  const firstMedia = order.findIndex((box) => box.typ === "mdat");
  if (firstMedia >= 0 && order.indexOf(moov) > firstMedia) {
    order.splice(order.indexOf(moov), 1);
    order.splice(firstMedia, 0, moov);
  }
  const newMoov = rebuildMoov(data, moov.off, moov.size, top, order);
  const out = order.map((box) => (box.typ === "moov" ? newMoov : data.subarray(box.off, box.off + box.size)));
  return Buffer.concat(out);
}

export function assertUnencryptedMp4(input: Uint8Array): void {
  const data = toBuf(input);
  const boxes = parseBoxes(data, 0, data.length);
  if (!boxes.some((box) => box.typ === "moov") || !boxes.some((box) => box.typ === "mdat")) {
    throw new Error("MP4 requires moov and mdat");
  }
  if (hasSampleEncryption(boxes) || mp4TrackInfo(data, boxes).some((track) => track.encrypted || track.ivs.length)) {
    throw new Error("Invalid CENC key");
  }
}

export function isHevcMp4Buffer(data: Uint8Array): boolean {
  const buf = toBuf(data);
  return hasFourcc(buf, "hvc1") || hasFourcc(buf, "hev1");
}
