// SPDX-License-Identifier: GPL-3.0-only
import { Buffer } from "buffer";
import crypto from "crypto";
import { gzipSync } from "zlib";
import { aes128CbcEncryptNoPad, md5HexUpper, pkcs7Pad16, sha512 } from "./crypto";
import type { JsonRequestOptions } from "./http";

const REGISTER_URL =
  "https://log5-applog-lf.fqnovel.com/service/2/device_register/?tt_data=a&cronet_version=8d40f833_2026-03-03&ttnet_version=4.2.243.31-douyin&use_store_region_cookie=1";
const KDF_SALT = Buffer.from(
  "4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58",
  "hex",
);

export interface PlaybackDeviceIdentity {
  readonly device_id: string;
  readonly iid: string;
  readonly cdid: string;
}

export type RequestJsonFn = (
  url: string,
  options: JsonRequestOptions,
  deadline?: number,
  signal?: AbortSignal,
) => Promise<any>;

function responseId(response: Record<string, unknown> | null | undefined, name: string): string {
  const preferred = response?.[`${name}_str`];
  const value =
    preferred === undefined || preferred === null || preferred === "" ? response?.[name] : preferred;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
  return typeof value === "string" && /^\d{1,30}$/.test(value) && /[1-9]/.test(value) ? value : "";
}

function createRegistrationRequest(): { options: JsonRequestOptions; cdid: string } {
  const now = Date.now();
  const cdid = crypto.randomUUID();
  const header = {
    display_name: "红果免费短剧",
    update_version_code: 73932,
    manifest_version_code: 73932,
    app_version_minor: "7.3.9.32",
    aid: 8662,
    channel: "update_64",
    package: "com.phoenix.read",
    app_version: "7.3.9.32",
    version_code: 73932,
    sdk_version: "3.7.0-rc.34-fanqie-xiaoshuo",
    sdk_target_version: 29,
    git_hash: "3a88f4e",
    os: "Android",
    os_version: "16",
    os_api: 36,
    device_model: "25053RT47C",
    device_brand: "Redmi",
    device_manufacturer: "Redmi",
    cpu_abi: "arm64-v8a",
    release_build: "b5e187f",
    density_dpi: 520,
    display_density: "mdpi",
    resolution: "1280x2772",
    language: "zh",
    timezone: 8,
    access: "wifi",
    not_request_sender: 0,
    carrier: "CHINA MOBILE",
    mcc_mnc: "46000",
    rom: "eng.root.20231116.160340",
    rom_version: "W528JS release-keys",
    cdid,
    sig_hash: "56a962410c494bbaf0b58dba20cae56f",
    openudid: crypto.randomBytes(8).toString("hex"),
    clientudid: crypto.randomUUID(),
    ipv6_list: [],
    region: "CN",
    tz_name: "Asia/Shanghai",
    tz_offset: 28800,
    sim_region: "cn",
    sim_serial_number: [],
    oaid_may_support: false,
    req_id: crypto.randomUUID(),
    device_platform: "android",
    custom: {
      account_region_src: "fallback",
      account_region: "cn",
      host_bit: 64,
      dragon_device_type: "phone",
    },
    pre_installed_channel: "",
    apk_first_install_time: now,
    is_system_app: 0,
    sdk_flavor: "china",
    guest_mode: 0,
  };

  const compressed = gzipSync(Buffer.from(JSON.stringify({ magic_tag: "ss_app_log", header, _gen_time: now })));
  const random = crypto.randomBytes(32);
  const derived = sha512(Buffer.concat([sha512(random), KDF_SALT]));
  const plaintext = Buffer.concat([sha512(compressed), compressed]);
  const encrypted = aes128CbcEncryptNoPad(
    pkcs7Pad16(plaintext),
    derived.subarray(0, 16),
    derived.subarray(16, 32),
  );
  const data = Buffer.concat([Buffer.from("746305100000", "hex"), random, encrypted]);

  const options: JsonRequestOptions = {
    method: "POST",
    headers: {
      "User-Agent": "com.phoenix.read/72232 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)",
      Accept: "application/json",
      "Content-Type": "application/octet-stream;tt-data=a",
      "log-encode-type": "gzip",
      "x-ss-dp": "8662",
      "x-ss-req-ticket": String(now),
      "x-vc-bdturing-sdk-version": "4.0.3.cn",
      lc: "101",
      "sdk-version": "2",
      "passport-sdk-version": "5051452",
      "x-neptune": "-8|50:51:59:30:40:47:49:39",
      "x-ss-stub": md5HexUpper(data),
    },
    data,
  };
  return { options, cdid };
}

function retryable(error: any): boolean {
  return (
    error?.status === 429 ||
    (typeof error?.status === "number" && error.status >= 500) ||
    [
      "ETIMEDOUT",
      "ECONNABORTED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNRESET",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EPIPE",
      "ERR_CANCELED",
      "ERR_NETWORK",
      "EMPTY_RESPONSE",
      "INVALID_RESPONSE",
      "INVALID_REGISTRATION",
    ].includes(error?.code)
  );
}

function waitForRegistration(
  promise: Promise<PlaybackDeviceIdentity>,
  signal?: AbortSignal,
): Promise<PlaybackDeviceIdentity> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<PlaybackDeviceIdentity>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export interface PlaybackDeviceRegistrar {
  (requestJson: RequestJsonFn, signal?: AbortSignal): Promise<PlaybackDeviceIdentity>;
  reset(expectedDevice?: PlaybackDeviceIdentity): boolean;
}

export function createPlaybackDeviceRegistrar(): PlaybackDeviceRegistrar {
  let registration: Promise<PlaybackDeviceIdentity> | undefined;
  let request: { options: JsonRequestOptions; cdid: string } | undefined;
  let currentDevice: PlaybackDeviceIdentity | undefined;

  const registrar = function getPlaybackDevice(
    requestJson: RequestJsonFn,
    signal?: AbortSignal,
  ): Promise<PlaybackDeviceIdentity> {
    if (signal?.aborted) return Promise.reject(signal.reason);

    registration ||= Promise.resolve()
      .then(async () => {
        request ||= createRegistrationRequest();
        const deadline = Date.now() + 8000;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const budget = deadline - Date.now();
            if (budget <= 0) throw Object.assign(new Error("Registration timed out"), { code: "ETIMEDOUT" });
            const response = await requestJson(
              REGISTER_URL,
              request.options,
              Date.now() + budget,
              AbortSignal.timeout(budget),
            );
            if (Number(response?.code ?? response?.Code ?? 0) !== 0) {
              throw Object.assign(new Error("Registration rejected"), { code: "REGISTRATION_REJECTED" });
            }
            const device_id = responseId(response, "device_id");
            const iid = responseId(response, "install_id");
            if (!device_id || !iid) {
              throw Object.assign(new Error("Invalid registration"), { code: "INVALID_REGISTRATION" });
            }
            currentDevice = Object.freeze({ device_id, iid, cdid: request.cdid });
            return currentDevice;
          } catch (error: any) {
            if (attempt === 2 || !retryable(error) || Date.now() >= deadline) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
        throw new Error("Registration failed");
      })
      .catch((error: any) => {
        registration = undefined;
        const reason = error?.status ? `HTTP ${error.status}` : error?.code || "INVALID_RESPONSE";
        throw Object.assign(new Error(`匿名播放设备注册失败（${reason}），请稍后重试`), {
          code: "DEVICE_REGISTRATION_FAILED",
          cause: error,
        });
      });

    return waitForRegistration(registration, signal);
  } as PlaybackDeviceRegistrar;

  registrar.reset = function resetPlaybackDevice(expectedDevice?: PlaybackDeviceIdentity): boolean {
    if (expectedDevice && currentDevice !== expectedDevice) return false;
    registration = undefined;
    request = undefined;
    currentDevice = undefined;
    return true;
  };

  return registrar;
}

export const getPlaybackDevice = createPlaybackDeviceRegistrar();
