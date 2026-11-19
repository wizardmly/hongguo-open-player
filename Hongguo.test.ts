import { Buffer } from "buffer";
import { describe, expect, test } from "nsh/test";
import { decryptSpadeUrl, deriveContentKey, signedMetadataRequest, signedSearchRequest } from "./src/hongguo/app-source";
import { PlayerSigner } from "./src/hongguo/argus";
import {
  aes128CbcDecryptNoPad,
  aes128CbcEncryptNoPad,
  assertUnencryptedMp4,
  decryptMp4Buffer,
  parseBoxes,
  pkcs7Pad16,
  readU32BE,
  sha512,
  sm3,
  writeU32BE,
} from "./src/hongguo/crypto";
import { baseParams, buildQuery, signCommentHeaders } from "./src/hongguo/danmaku-sign";
import { urlToLocalPath } from "./src/hongguo/http";

function box(type: string, ...parts: Uint8Array[]): Buffer {
  const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
  const out = Buffer.alloc(8 + body.length);
  writeU32BE(out, out.length, 0);
  out.write(type, 4, 4, "latin1");
  body.copy(out, 8);
  return out;
}

function fullBox(type: string, versionFlags: number, ...parts: Uint8Array[]): Buffer {
  const hdr = Buffer.alloc(4);
  writeU32BE(hdr, versionFlags, 0);
  return box(type, hdr, ...parts);
}

function u32(val: number): Buffer {
  const b = Buffer.alloc(4);
  writeU32BE(b, val, 0);
  return b;
}

function encodeSpadeKeyForTest(keyHex32: string): string {
  // Inverse of deriveContentKey():
  // work[i] = (-21 - pop(i) + (previous ^ old)) & 255
  // => old = (work[i] + 21 + pop(i)) & 255 ^ previous
  const plainWork = Buffer.concat([Buffer.from([0x30]), Buffer.from(keyHex32, "ascii"), Buffer.from([0x00])]);
  const v8 = plainWork.length; // 34
  const encoded = Buffer.alloc(v8);
  let a = 85;
  let b = 246;
  for (let i = 0; i < v8; i += 1) {
    const previous = i & 1 ? a : b;
    const pop = i.toString(2).split("1").length - 1;
    const old = ((plainWork[i] + 21 + pop) & 255) ^ previous;
    encoded[i] = old;
    if (i & 1) a = old;
    else b = old;
  }
  const key0 = 47 + 4; // L - v8 + 47 = 51 => buf = [hdr, ...encoded, ...pad(3)] (total L=38, key0=51 => v8=38-51+47=34)
  const buf = Buffer.alloc(v8 + 4);
  encoded.copy(buf, 1);
  buf[0] = key0 ^ buf[1] ^ buf[2];
  return buf.toString("base64");
}

describe("hongguo crypto & protocol signing", () => {
  test("computes standard GB/T 32905 SM3 digests", () => {
    expect(sm3("abc").toString("hex")).toBe("66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0");
    expect(sm3("").toString("hex")).toBe("1ab21d8355cfa17f8e61194831e81a8f22bec8c728fefb747ed035eb5082aa2b");
  });

  test("encrypts and decrypts NIST SP 800-38A AES-128-CBC vectors + PKCS#7 round-trip", () => {
    const key = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");
    const iv = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    const pt = Buffer.from("6bc1bee22e409f96e93d7e117393172a", "hex");
    const ct = aes128CbcEncryptNoPad(pt, key, iv);
    expect(ct.toString("hex")).toBe("7649abac8119b246cee98e9b12e9197d");
    expect(aes128CbcDecryptNoPad(ct, key, iv).toString("hex")).toBe(pt.toString("hex"));

    const msg = Buffer.from("hongguo-nsh-v2-roundtrip", "utf8");
    const padded = pkcs7Pad16(msg);
    expect(padded.length % 16).toBe(0);
    const enc = aes128CbcEncryptNoPad(padded, key, iv);
    const dec = aes128CbcDecryptNoPad(enc, key, iv);
    const padLen = dec[dec.length - 1];
    expect(dec.subarray(0, dec.length - padLen).toString("utf8")).toBe("hongguo-nsh-v2-roundtrip");
  });

  test("generates valid danmaku and player protocol signatures", () => {
    const query = buildQuery({
      stampMs: 1735000000123,
      deviceId: "1234567890123456789",
      installId: "2345678901234567890",
    });
    expect(baseParams("1", "2").aid).toBe("8662");

    const nonce = Buffer.from("0102030405060708090a0b", "hex");
    const commentHeaders = signCommentHeaders({ rawQuery: query, stamp: 1735000000, nonce });
    expect(commentHeaders["X-Gorgon"].startsWith("8404")).toBe(true);
    expect(commentHeaders["X-Gorgon"].length).toBe(52);
    expect(commentHeaders["X-Argus"].length).toBeGreaterThan(20);
    expect(commentHeaders["X-Ladon"].length).toBeGreaterThan(20);
    expect(commentHeaders["X-Khronos"]).toBe("1735000000");

    const playerHeaders = PlayerSigner.headers(
      "aid=8662&device_id=1234567890123456789&iid=2345678901234567890",
      Buffer.from("{\"ok\":true}", "utf8"),
      1735000000,
    );
    expect(playerHeaders["x-argus"].length).toBeGreaterThan(20);
    expect(playerHeaders["x-ladon"].length).toBeGreaterThan(20);
    expect(playerHeaders["x-khronos"]).toBe("1735000000");
    expect(playerHeaders["x-ss-stub"].length).toBe(32);

    // Exercise buildMedusa / signedMetadataRequest / signedSearchRequest repeatedly across random values under LLRT
    for (let i = 0; i < 16; i += 1) {
      const meta = signedMetadataRequest("/reading/bookapi/bookmall/cell/change/v", { tab_type: "26" }, null);
      expect(Boolean(meta.headers["x-medusa"] && meta.headers["x-gorgon"] && meta.headers["x-helios"])).toBe(true);
      const search = signedSearchRequest({
        keyword: "测试",
        page: 1,
        identity: {
          device_id: "1234567890123456",
          iid: "2345678901234567",
          cdid: "11111111-2222-4333-8444-555555555555",
        },
      });
      expect(Boolean(search.headers["x-medusa"] && search.headers["x-gorgon"] && search.headers["x-helios"])).toBe(true);
    }
  });

  test("derives spade_a content key and decrypts spade play URL", () => {
    const keyHex = "00112233445566778899aabbccddeeff";
    const spadeA = encodeSpadeKeyForTest(keyHex);
    const derived = deriveContentKey(spadeA);
    expect(derived.toString("hex")).toBe(keyHex);

    const url = "https://v3-default.fqnovelvod.com/test/video.mp4";
    const constants = Buffer.from(
      "4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58",
      "hex",
    );
    const h1 = sha512(derived);
    const h2 = sha512(Buffer.concat([h1, constants]));
    const paddedUrl = pkcs7Pad16(Buffer.from(url, "utf8"));
    const encUrl = aes128CbcEncryptNoPad(paddedUrl, h2.subarray(0, 16), h2.subarray(16, 32));
    const envelope = Buffer.concat([Buffer.from([0xa8, 0x00, 0x01, 0x00]), encUrl]).toString("base64");

    expect(decryptSpadeUrl(envelope, derived)).toBe(url);
  });

  test("decrypts synthetic CENC AES-128-CTR MP4, strips sinf/senc, and relocates moov before mdat", async () => {
    const keyBytes = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const iv0 = Buffer.from("0102030405060708", "hex");
    const iv1 = Buffer.from("1112131415161718", "hex");
    const sample0 = Buffer.from("0000001c65888421aabbccddeeff00112233445566778899aabbccddeeff", "utf8").subarray(0, 24);
    const sample1 = Buffer.from("sample-one-hevc-nalu-payload-0123456789ab", "utf8");

    const rawKey = new Uint8Array(keyBytes);
    const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CTR" }, false, ["encrypt"]);
    const encSample0 = Buffer.from(
      await crypto.subtle.encrypt(
        { name: "AES-CTR", counter: Buffer.concat([iv0, Buffer.alloc(8)]), length: 64 },
        cryptoKey,
        sample0,
      ),
    );
    const encSample1 = Buffer.from(
      await crypto.subtle.encrypt(
        { name: "AES-CTR", counter: Buffer.concat([iv1, Buffer.alloc(8)]), length: 64 },
        cryptoKey,
        sample1,
      ),
    );

    const ftyp = box("ftyp", Buffer.from("isom", "latin1"), u32(0x200), Buffer.from("isomiso2", "latin1"));
    const mdat = box("mdat", encSample0, encSample1);
    const chunkOff = ftyp.length + 8; // Original offset of encSample0 inside trailing mdat->moov layout

    const avcC = box("avcC", Buffer.from([1, 0x64, 0, 0x1f]));
    const frma = box("frma", Buffer.from("avc1", "latin1"));
    const sinf = box("sinf", frma);
    const encv = box("encv", Buffer.alloc(78), avcC, sinf);
    const stsd = fullBox("stsd", 0, u32(1), encv);
    const stsz = fullBox("stsz", 0, u32(0), u32(2), u32(sample0.length), u32(sample1.length));
    const stsc = fullBox("stsc", 0, u32(1), u32(1), u32(2), u32(1));
    const stco = fullBox("stco", 0, u32(1), u32(chunkOff));
    const senc = fullBox("senc", 0, u32(2), iv0, iv1);
    const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", stsd, stsz, stsc, stco, senc)))));

    const encryptedMp4 = Buffer.concat([ftyp, mdat, moov]);
    expect(() => assertUnencryptedMp4(encryptedMp4)).toThrow("Invalid CENC key");

    const decryptedMp4 = await decryptMp4Buffer(encryptedMp4, keyBytes);
    assertUnencryptedMp4(decryptedMp4);

    const top = parseBoxes(decryptedMp4, 0, decryptedMp4.length);
    expect(top.map((b) => b.typ)).toEqual(["ftyp", "moov", "mdat"]);

    const outMoov = top[1];
    const outMdat = top[2];
    expect(decryptedMp4.subarray(outMdat.off + 8, outMdat.off + 8 + sample0.length).toString("hex")).toBe(
      sample0.toString("hex"),
    );
    expect(
      decryptedMp4.subarray(outMdat.off + 8 + sample0.length, outMdat.off + 8 + sample0.length + sample1.length).toString("hex"),
    ).toBe(sample1.toString("hex"));

    // Verify stsd rewritten to avc1 and stco shifted forward by outMoov.size
    expect(decryptedMp4.subarray(outMoov.off, outMoov.off + outMoov.size).toString("latin1").includes("avc1")).toBe(true);
    expect(decryptedMp4.subarray(outMoov.off, outMoov.off + outMoov.size).toString("latin1").includes("encv")).toBe(false);
    expect(decryptedMp4.subarray(outMoov.off, outMoov.off + outMoov.size).toString("latin1").includes("senc")).toBe(false);

    const outStbl = parseBoxes(decryptedMp4, outMoov.off + 8, outMoov.off + outMoov.size)[0]
      .children![0].children![0].children![0].children!;
    const outStco = outStbl.find((b) => b.typ === "stco")!;
    expect(readU32BE(decryptedMp4, outStco.off + 16)).toBe(outMdat.off + 8);
  });

  test("decodes percent-encoded UTF-8 Chinese and space paths in module file URLs", () => {
    expect(
      urlToLocalPath(
        new URL(
          "../../",
          "file:///D:/dist/windows-v2.0.2/%E7%BA%A2%E6%9E%9C%E5%BC%80%E6%BA%90%E6%92%AD%E6%94%BE%E5%99%A8/nsh/src/hongguo/signer.ts",
        ).href,
      ),
    ).toBe("D:\\dist\\windows-v2.0.2\\红果开源播放器\\nsh");
    expect(urlToLocalPath("file:///C:/Users/Test%20User/Desktop/%E7%BA%A2%E6%9E%9C%20%231/nsh/App.tsx")).toBe(
      "C:\\Users\\Test User\\Desktop\\红果 #1\\nsh\\App.tsx",
    );
    expect(urlToLocalPath("file:///Users/jake/%E7%BA%A2%E6%9E%9C/nsh")).toBe("/Users/jake/红果/nsh");
  });
});
