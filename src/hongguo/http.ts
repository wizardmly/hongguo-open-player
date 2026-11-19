// SPDX-License-Identifier: GPL-3.0-only
import { Buffer } from "buffer";
import crypto from "crypto";

export const SITE_ORIGIN = "https://hongguoduanju.com";
export const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
export const WEB_REFERER = `${SITE_ORIGIN}/`;

export function cleanWinPath(p: string): string {
  return p.replace(/^[/\\]+([A-Za-z]:)/, "$1");
}

/** Converts a `file:` module URL into a local OS path, properly percent-decoding UTF-8 segments. */
export function urlToLocalPath(rawUrl: string): string {
  const u = new URL(rawUrl);
  if (u.protocol !== "file:") {
    throw new Error(`Unsupported module URL scheme: ${u.protocol}`);
  }
  let pathname = decodeURIComponent(u.pathname);
  if (/^\/[A-Za-z]:/.test(pathname)) {
    pathname = pathname.slice(1);
  }
  if (u.host && u.host !== "localhost") {
    const unc = `\\\\${decodeURIComponent(u.host)}${pathname.replace(/\//g, "\\")}`;
    return unc.length > 2 ? unc.replace(/\\+$/, "") : unc;
  }
  if (/^[A-Za-z]:/.test(pathname)) {
    const win = pathname.replace(/\//g, "\\");
    return /^[A-Za-z]:\\$/.test(win) ? win : win.replace(/\\+$/, "");
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isPrivateOrReservedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (!lower || lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (lower === "::1" || lower === "[::1]" || lower.startsWith("fe80:") || lower.startsWith("[fe80:")) return true;
  const ipv4 = lower.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;
  const [, a, b] = ipv4.map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isPublicMediaUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.username || parsed.password) return false;
    return !isPrivateOrReservedHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function checkedUrl(value: string, domains: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error("App 片源地址格式无效"), { code: "INVALID_RESPONSE" });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  ) {
    throw Object.assign(new Error("App 片源返回了不受支持的服务地址"), { code: "SECURITY_BLOCKED" });
  }
  return url.href;
}

export function abortableSignal(deadline: number, externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const remaining = Math.max(1, deadline - Date.now());
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(Object.assign(new Error("请求超时"), { code: "ETIMEDOUT", name: "TimeoutError" }));
  }, remaining);

  if (!externalSignal) {
    return {
      signal: timeoutController.signal,
      cleanup: () => clearTimeout(timer),
    };
  }
  const combined = AbortSignal.any([timeoutController.signal, externalSignal]);
  return {
    signal: combined,
    cleanup: () => clearTimeout(timer),
  };
}

export interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: Uint8Array | string | null;
}

export async function requestJson(
  url: string,
  options: JsonRequestOptions = {},
  deadline = Date.now() + 12000,
  externalSignal?: AbortSignal,
): Promise<any> {
  const method = (options.method || "GET").toUpperCase();
  let currentUrl = url;

  for (let redirects = 0; redirects < 4; redirects++) {
    currentUrl = checkedUrl(currentUrl, ["fqnovel.com", "snssdk.com"]);
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw Object.assign(new Error("App 片源请求超时"), { code: "ETIMEDOUT" });

    const { signal, cleanup } = abortableSignal(deadline, externalSignal);
    let response: Response;
    let raw = "";
    try {
      const headers: Record<string, string> = { ...(options.headers || {}) };
      const bodyInit =
        options.data == null
          ? undefined
          : typeof options.data === "string"
            ? options.data
            : new Uint8Array(options.data);
      response = await fetch(currentUrl, {
        method,
        headers,
        body: bodyInit,
        redirect: "manual",
        signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const loc = response.headers.get("location");
        if (method === "POST" || !loc) {
          throw Object.assign(new Error("App 接口发生不支持的跳转"), { code: "SECURITY_BLOCKED" });
        }
        currentUrl = checkedUrl(new URL(loc, currentUrl).href, ["fqnovel.com", "snssdk.com"]);
        continue;
      }

      raw = await response.text();
    } catch (error: any) {
      if (error?.code === "SECURITY_BLOCKED") throw error;
      const isAborted = Boolean(externalSignal?.aborted);
      if (isAborted) {
        throw Object.assign(new Error("App 片源请求已取消"), { code: "ERR_CANCELED" });
      }
      const timedOut = error?.code === "ETIMEDOUT" || error?.name === "TimeoutError" || error?.name === "AbortError";
      throw Object.assign(new Error(timedOut ? "App 片源请求超时" : "App 片源网络请求失败，请稍后重试"), {
        code: timedOut ? "ETIMEDOUT" : "ERR_NETWORK",
        requestId: crypto.randomUUID(),
      });
    } finally {
      cleanup();
    }

    if (response.status !== 200) {
      throw Object.assign(new Error(`App 片源请求失败（HTTP ${response.status}）`), { status: response.status });
    }
    if (!raw.trim()) {
      throw Object.assign(new Error("播放服务返回空响应，请重试本集"), {
        code: "EMPTY_RESPONSE",
        status: response.status,
        logid: response.headers.get("x-tt-logid") || "",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error("App 接口未返回有效数据"), { code: "INVALID_RESPONSE" });
    }
    if (!parsed || typeof parsed !== "object") {
      throw Object.assign(new Error("App 接口未返回有效数据"), { code: "INVALID_RESPONSE" });
    }
    return parsed;
  }

  throw Object.assign(new Error("App 片源跳转次数过多"), { code: "SECURITY_BLOCKED" });
}

export async function fetchSiteHtml(
  url: string,
  timeoutMs = 15000,
  externalSignal?: AbortSignal,
): Promise<string> {
  const { signal, cleanup } = abortableSignal(Date.now() + timeoutMs, externalSignal);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": WEB_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: WEB_REFERER,
      },
      redirect: "follow",
      signal,
    });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.text();
  } finally {
    cleanup();
  }
}

export function concatUint8Arrays(chunks: Uint8Array[]): Buffer {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = Buffer.alloc(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
