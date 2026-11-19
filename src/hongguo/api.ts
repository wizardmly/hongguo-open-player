// SPDX-License-Identifier: GPL-3.0-only
import { Buffer } from "buffer";
import crypto from "crypto";
import { parseSearchInteger, signedMetadataRequest, signedSearchRequest } from "./app-source";
import { commentArgus, commentLadon, commentXGorgon, newDeviceId, baseParams, NONCE_BYTES, buildQuery, signCommentHeaders } from "./danmaku-sign";
import { getPlaybackDevice } from "./device";
import { abortableSignal, fetchSiteHtml, isPublicMediaUrl, requestJson, SITE_ORIGIN, WEB_UA } from "./http";

// ── Shared Text & Cover Cleaners ─────────────────────────────────────────────

export function cleanTitle(value: unknown): string {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function appCover(value: unknown): string {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  return /\.heic(?:\?|$)/i.test(url) ? "" : url;
}

export function catalogCover(value: unknown): string {
  const compatible = appCover(value);
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const url = new URL(raw);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      /(^|\.)(fqnovelpic\.com|byteimg\.com)$/i.test(url.hostname) &&
      url.pathname.startsWith("/novel-pic/") &&
      url.pathname.includes("~")
    ) {
      return `https://p3-novel.byteimg.com${url.pathname.split("~", 1)[0]}~tplv-shrink:640:0.image`;
    }
    return compatible;
  } catch {
    return compatible;
  }
}

function actorCover(value: unknown): string {
  const compatible = appCover(value);
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const url = new URL(raw);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      /(^|\.)(fqnovelpic\.com|byteimg\.com)$/i.test(url.hostname) &&
      url.pathname.startsWith("/novel-pic/")
    ) {
      const basePath = url.pathname.split("~", 1)[0].replace(/\.(heic|jpeg|jpg|png|webp)$/i, "");
      return `https://p3-novel.byteimg.com${basePath}~tplv-shrink:640:0.image`;
    }
    return compatible;
  } catch {
    return compatible;
  }
}

function cleanUrl(value: unknown): string {
  return String(value || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&");
}

// ── Search Relevance ─────────────────────────────────────────────────────────

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return ["name", "nickname", "tag_name", "title", "text", "sub_title"]
      .map((key) => textOf(rec[key]))
      .join(" ");
  }
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/g, ">")
        .normalize("NFKC")
        .toLowerCase()
    : "";
}

export function matchesSearchKeyword(keyword: string, ...fields: unknown[]): boolean {
  const terms = textOf(keyword).trim().split(/\s+/).filter(Boolean);
  const metadata = fields.map(textOf).join(" ");
  return terms.every((term) => metadata.includes(term));
}

// ── Catalog & Rankings (`hongguo-app-catalog`) ───────────────────────────────

const CATEGORY_API = "/reading/distribution/category/landpage/v/";
const RANK_API = "/reading/bookapi/bookmall/cell/change/v";
const CATEGORIES: Record<string, [string, string]> = {
  "real-drama": ["default", "short_play"],
  "comic-drama": ["comic_series", "comic_series"],
  "ai-drama": ["ai_series", "ai_series"],
};
const RANKS: Record<string, [string, string]> = {
  "hot-drama": ["all", "ranklist_hot_play_sc"],
  "hot-real-drama": ["human", "human_hot_play"],
  "hot-comic-drama": ["comic_series_rank", "comic_series_hot_play"],
  "hot-ai-drama": ["ai_playlet", "ai_playlet_hot_play"],
};
const CATALOG_TIMEOUT_MS = 10000;
const CATALOG_CACHE_MS = 120000;
const MAX_CATALOG_SESSIONS = 32;
const MAX_CATALOG_PAGES = 8;

interface CatalogCursor {
  offset: number;
  sessionId: string;
}

interface CatalogSessionState {
  expires: number;
  genres: { slug: string; label: string }[];
  pages: Map<number, any>;
  cursors: Map<number, CatalogCursor>;
  pending: Map<number, { promise: Promise<any>; controller: AbortController; forceRefresh: boolean }>;
}

const catalogSessions = new Map<string, CatalogSessionState>();

function discardCatalogSession(key: string, state: CatalogSessionState): void {
  for (const request of state.pending.values()) request.controller.abort();
  catalogSessions.delete(key);
}

function mapCatalogCards(rows: any[], contentTypes: number[]) {
  const seen = new Set<string>();
  return rows.flatMap((video) => {
    const rawId = video?.series_id;
    if (typeof rawId === "number" && !Number.isSafeInteger(rawId)) return [];
    const id = String(rawId || "");
    const title = cleanTitle(video?.title || video?.series_title || video?.series_name);
    if (!/^\d{1,30}$/.test(id) || !title || seen.has(id) || !contentTypes.includes(Number(video.content_type))) {
      return [];
    }
    seen.add(id);
    const tags = Array.isArray(video.sub_title_list)
      ? video.sub_title_list.map((item: any) => cleanTitle(item?.content)).filter(Boolean).slice(0, 4)
      : [];
    return [
      {
        series_id: id,
        series_title: title,
        cover: catalogCover(video.cover),
        episode_count: parseSearchInteger(video.episode_cnt) || 0,
        description: cleanTitle(video.video_desc || video.series_intro),
        tags,
        completion_status: "unknown",
        source: "hongguo",
        url: `${SITE_ORIGIN}/detail?series_id=${id}`,
      },
    ];
  });
}

function parseCatalogPage(
  payload: any,
  category: string,
  genre: string,
  page: number,
  cursor: CatalogCursor,
  state: CatalogSessionState,
  sourceUrl: string,
) {
  if (!payload || typeof payload !== "object" || !Object.prototype.hasOwnProperty.call(payload, "code")) {
    throw Object.assign(new Error("App 目录返回异常数据"), { code: "APP_SCHEMA" });
  }
  if (Number(payload.code) !== 0) {
    throw Object.assign(new Error("App 目录服务暂不可用"), { code: "APP_BUSINESS" });
  }
  const data = payload.data;
  if (!data || typeof data !== "object") {
    throw Object.assign(new Error("App 目录缺少列表数据"), { code: "APP_SCHEMA" });
  }
  const ranking = RANKS[category];
  const view = data.cell_view;
  let rows: any[];
  let genres = state.genres;

  if (ranking) {
    if (!Array.isArray(view?.cell_data)) {
      throw Object.assign(new Error("App 榜单结构异常"), { code: "APP_SCHEMA" });
    }
    const selected = view.cell_selector?.outer_row?.items?.find((item: any) => item.is_selected === true);
    const child = selected?.sub_cell_selector?.outer_row?.items?.find((item: any) => item.is_selected === true);
    if (selected && (selected.selector_item_id !== ranking[0] || child?.selector_item_id !== ranking[1])) {
      throw Object.assign(new Error("App 返回了其他榜单"), { code: "APP_SCHEMA" });
    }
    rows = view.cell_data.flatMap((cell: any) =>
      Array.isArray(cell?.video_data) ? cell.video_data : cell?.video_data ? [cell.video_data] : [],
    );
    if (!rows.length && view.cell_data.some((cell: any) => cell?.ugc_user_data?.length)) {
      throw Object.assign(new Error("App 返回了演员榜，未作为短剧展示"), { code: "APP_SCHEMA" });
    }
  } else {
    if (!Array.isArray(data.video_data)) {
      throw Object.assign(new Error("App 分类结构异常"), { code: "APP_SCHEMA" });
    }
    rows = data.video_data;
    if (Array.isArray(data.selector_rows) && (page === 1 || data.selector_rows.length)) {
      const themes = data.selector_rows.find((row: any) => row?.type === "category_dim_theme");
      const seen = new Set<string>();
      genres = (Array.isArray(themes?.items) ? themes.items : []).flatMap((item: any) => {
        const slug = String(item?.selector_item_id || "");
        const label = cleanTitle(item?.show_name);
        if (!/^cate_\d{1,8}$/.test(slug) || !label || seen.has(slug)) return [];
        seen.add(slug);
        return [{ slug, label }];
      });
      if (genre && !genres.some((item) => item.slug === genre)) {
        throw Object.assign(new Error("App 题材已变化，请重新加载分类"), { code: "APP_INPUT" });
      }
    }
  }

  const liveAction = category === "real-drama" || category === "hot-real-drama";
  const results = mapCatalogCards(rows, category === "hot-drama" ? [1, 1004] : liveAction ? [1] : [1004]);
  if (rows.length && !results.length) {
    throw Object.assign(new Error("App 目录未返回有效短剧"), { code: "APP_SCHEMA" });
  }
  const more = (data.has_more ?? view?.has_more) === true;
  const offset = parseSearchInteger(data.next_offset ?? view?.next_offset);
  const sessionId = data.session_id ?? view?.session_id;
  if (
    more &&
    (offset === null || offset <= cursor.offset || typeof sessionId !== "string" || !sessionId || sessionId.length > 4096)
  ) {
    throw Object.assign(new Error("App 分页游标无效，请重新加载第 1 页"), { code: "APP_CURSOR" });
  }
  return {
    response: { success: true, results, page, total: 0, totalPages: 0, hasMore: more && page < 50, genres, sourceUrl },
    next: more && page < 50 ? { offset: offset!, sessionId } : null,
  };
}

async function browseList(options: {
  category?: string;
  genre?: string;
  page?: number;
  forceRefresh?: boolean;
  catalogScope?: string;
} = {}) {
  const { category = "real-drama", genre = "", page = 1, forceRefresh = false, catalogScope = "default" } = options;
  const pg = parseSearchInteger(page);
  const ranking = RANKS[category];
  const sourceUrl = `${SITE_ORIGIN}/${ranking ? "rank" : "category"}/${encodeURIComponent(category)}${pg && pg > 1 ? `?page=${pg}` : ""}`;
  const fail = (err: any) => ({
    success: false,
    error: `${err.message}，可重试或切换官网`,
    code: err.code || "APP_NETWORK",
    sourceUrl,
  });

  if (
    (!Object.prototype.hasOwnProperty.call(CATEGORIES, category) &&
      !Object.prototype.hasOwnProperty.call(RANKS, category) &&
      category !== "comic") ||
    !["default", "browse"].includes(catalogScope) ||
    typeof genre !== "string" ||
    (genre && (!/^cate_\d{1,8}$/.test(genre) || ranking)) ||
    pg === null ||
    pg < 1 ||
    pg > 50
  ) {
    return fail({ message: "App 分类、题材或页码无效", code: "APP_INPUT" });
  }
  if (category === "comic") {
    return {
      success: true,
      results: [],
      page: 1,
      total: 0,
      totalPages: 0,
      hasMore: false,
      genres: [],
      sourceUrl,
      unsupported: true,
      emptyMessage: "漫画属于图文阅读，暂不支持视频播放或下载；请切换「漫剧」或打开官网阅读。",
    };
  }

  const key = `${catalogScope}\0${category}\0${genre}`;
  let state = catalogSessions.get(key);
  if (state && (state.expires <= Date.now() || (forceRefresh && pg === 1 && !state.pending.get(1)?.forceRefresh))) {
    discardCatalogSession(key, state);
    state = undefined;
  }
  if (!state) {
    if (pg !== 1) return fail({ message: "App 分页记录已失效，请重新加载第 1 页", code: "APP_CURSOR" });
    state = {
      expires: Date.now() + CATALOG_CACHE_MS,
      genres: [],
      pages: new Map(),
      cursors: new Map([[1, { offset: 0, sessionId: "" }]]),
      pending: new Map(),
    };
    catalogSessions.set(key, state);
    if (catalogSessions.size > MAX_CATALOG_SESSIONS) {
      const oldest = catalogSessions.keys().next().value;
      if (oldest) {
        const oldState = catalogSessions.get(oldest);
        if (oldState) discardCatalogSession(oldest, oldState);
      }
    }
  }
  if (state.pending.has(pg)) return state.pending.get(pg)!.promise;
  if (!forceRefresh && state.pages.has(pg)) return state.pages.get(pg);
  const cursor = state.cursors.get(pg);
  if (!cursor) return fail({ message: "App 尚无这一页的游标，请逐页浏览或重新加载第 1 页", code: "APP_CURSOR" });

  if (forceRefresh) {
    for (const cachedPage of [...state.pages.keys()]) if (cachedPage >= pg) state.pages.delete(cachedPage);
    for (const cursorPage of [...state.cursors.keys()]) if (cursorPage > pg) state.cursors.delete(cursorPage);
    for (const [pendingPage, req] of [...state.pending.entries()]) {
      if (pendingPage > pg) {
        state.pending.delete(pendingPage);
        req.controller.abort();
      }
    }
  }

  const controller = new AbortController();
  const deadline = Date.now() + CATALOG_TIMEOUT_MS;
  const timeoutTimer = setTimeout(() => controller.abort(Object.assign(new Error("App 目录加载超时"), { code: "APP_TIMEOUT" })), CATALOG_TIMEOUT_MS);

  let promise!: Promise<any>;
  promise = (async () => {
    try {
      controller.signal.throwIfAborted();
      let values: Record<string, string> = {};
      let body: unknown = null;
      if (ranking) {
        values = {
          tab_type: pg === 1 ? "26" : "18",
          client_req_type: "2",
          client_template: "2",
          background_selected_items: "",
          category_id: "0",
          limit: "20",
          cell_sub_id: "0",
          gender: "2",
          cell_id: "7470092475068071998",
          selected_items: ranking[0],
          sub_selected_items: ranking[1],
          panel_selected_items: "",
          offset: String(cursor.offset),
          session_id: cursor.sessionId,
          filter_ids: "",
          unlimited_selector_change_type: "0",
        };
      } else {
        body = {
          filter_ids: "",
          req_scene: CATEGORIES[category][0],
          offset: cursor.offset,
          need_selector_panel: pg === 1,
          limit: 15,
          select_items: {
            genre: [CATEGORIES[category][1]],
            sort: ["hot_score"],
            category_dim_theme: genre ? [genre] : [],
            category_dim_role: [],
            category_dim_epoch: [],
            gender: [],
            online_time: [],
            creation_status: [],
          },
          session_id: cursor.sessionId,
          req_type: pg === 1 ? "default" : "only_content",
          client_req_type: 3,
        };
      }
      const signed = signedMetadataRequest(ranking ? RANK_API : CATEGORY_API, values, body);
      const payload = await requestJson(
        signed.url,
        { method: ranking ? "GET" : "POST", headers: signed.headers, data: signed.body },
        deadline,
        controller.signal,
      );
      const parsed = parseCatalogPage(payload, category, genre, pg, cursor, state!, sourceUrl);
      if (catalogSessions.get(key) === state && !controller.signal.aborted) {
        state.genres = parsed.response.genres;
        state.pages.set(pg, parsed.response);
        if (state.pages.size > MAX_CATALOG_PAGES) {
          const evict = [...state.pages.keys()].find((cachedPage) => cachedPage !== 1);
          if (evict !== undefined) state.pages.delete(evict);
        }
        if (parsed.next) state.cursors.set(pg + 1, parsed.next);
        else state.cursors.delete(pg + 1);
      }
      return parsed.response;
    } catch (error: any) {
      console.warn("[HongguoCatalog] browseList failed:", category, error?.code, error?.status, error?.message);
      return fail({
        message: /TIMEOUT|ETIMEDOUT/i.test(error?.code || "") ? "App 目录加载超时" : error?.message || "App 目录网络请求失败",
        code: error?.code?.startsWith("APP_") ? error.code : "APP_NETWORK",
      });
    } finally {
      clearTimeout(timeoutTimer);
      if (state!.pending.get(pg)?.promise === promise) state!.pending.delete(pg);
    }
  })();

  state.pending.set(pg, { promise, controller, forceRefresh });
  return promise;
}

export async function browseCatalog(options: { category?: string; genre?: string; page?: number } = {}) {
  const page = Number(options.page) || 1;
  const category = options.category || "hot-drama";
  const genre = options.genre || "";
  try {
    const res = await browseList({ page, category, genre });
    if (res && res.success !== false && Array.isArray((res as any).results)) {
      return res;
    }
  } catch {
    // Fall through to fallback
  }

  if (category !== "hot-drama" || genre) {
    throw Object.assign(new Error("所选分类暂不可用，请稍后重试"), { status: 502 });
  }
  const fallback = await searchHongguoDramas("热播", page);
  if (fallback && Array.isArray(fallback.results) && fallback.results.length > 0) {
    return {
      results: fallback.results,
      page,
      total: fallback.total || fallback.results.length,
      hasMore: fallback.hasMore || false,
      fallback: true,
    };
  }
  return { results: [], page, total: 0, hasMore: false };
}

// ── Web + App Dual-Channel Search (`hongguo-search` + `hongguo-app-search`) ─

const SEARCH_ENDPOINT = `${SITE_ORIGIN}/api/search/result`;
const SEARCH_CACHE_TTL_MS = 60 * 1000;
const webSearchCache = new Map<string, { value: any; expires: number }>();
const appSearchSessions = new Map<string, { expires: number; cursors: Map<number, any> }>();

function safeCover(value: unknown): string {
  const url = cleanUrl(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function episodeCountOf(video: any): number {
  const count = Number(video?.episode_cnt);
  if (Number.isInteger(count) && count > 0) return count;
  const right = String(video?.episode_right_text || "");
  const match = right.match(/(\d+)\s*集/);
  return match ? Number(match[1]) : 0;
}

function tagsOf(video: any): string[] {
  const list = Array.isArray(video?.tags)
    ? video.tags
    : Array.isArray(video?.category_list)
      ? video.category_list
      : [];
  const tags: string[] = [];
  for (const item of list) {
    const label = typeof item === "string" ? item : item?.name || item?.tag_name || item?.title;
    const text = String(label || "").trim();
    if (text && !tags.includes(text)) tags.push(text);
    if (tags.length >= 4) break;
  }
  return tags;
}

function parseWebSearchResponse(payload: any, keyword: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.code === "string") {
    throw new Error("Web 搜索返回异常");
  }
  if (!Array.isArray(payload.searchList)) throw new Error("Web 搜索缺少 searchList");

  const results: any[] = [];
  let recognizedCount = 0;
  const seen = new Set<string>();
  for (const item of payload.searchList) {
    const videoData = item?.video_data;
    const video = videoData && typeof videoData === "object" && Object.keys(videoData).length ? videoData : item;
    const seriesId = String(video?.series_id || item?.series_id || item?.keyword || "").trim();
    const title = cleanTitle(video?.series_name || video?.series_title || item?.name || video?.title || "");
    if (!/^\d{6,}$/.test(seriesId) || !title || seen.has(seriesId)) continue;
    seen.add(seriesId);
    recognizedCount++;
    if (
      !matchesSearchKeyword(
        keyword,
        title,
        item?.name,
        video?.series_intro,
        video?.tags,
        video?.category_list,
        video?.celebrities,
      )
    ) {
      continue;
    }
    results.push({
      series_id: seriesId,
      series_title: title,
      cover: safeCover(video?.series_cover || video?.cover || ""),
      episode_count: episodeCountOf(video),
      tags: tagsOf(video),
      description: cleanTitle(video?.series_intro || ""),
      url: `${SITE_ORIGIN}/detail?series_id=${seriesId}`,
    });
  }
  if (!recognizedCount && payload.searchList.length > 0) throw new Error("Web 搜索条目无法识别");
  const total = Number(payload.totalCount);
  const totalPages = Number(payload.totalPages);
  const page = Number(payload.pageNum);
  if (!results.length) {
    return { results: [], total: 0, totalPages: 0, page: page >= 1 ? page : 1, hasMore: false };
  }
  return {
    results,
    total: Number.isFinite(total) && total >= 0 ? total : results.length,
    totalPages: Number.isFinite(totalPages) && totalPages >= 0 ? totalPages : 0,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    hasMore: payload.hasMore === true,
  };
}

async function searchWeb(keyword: string, page: number) {
  const kw = String(keyword ?? "").normalize("NFKC").trim();
  const key = `${kw}\0${page}`;
  const cached = webSearchCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const target = `${SEARCH_ENDPOINT}?aid=8662&query=${encodeURIComponent(kw)}&page=${encodeURIComponent(String(page))}`;
  const { signal, cleanup } = abortableSignal(Date.now() + 10000);
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: {
        "User-Agent": WEB_UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: `${SITE_ORIGIN}/`,
      },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const parsed = parseWebSearchResponse(payload, kw);
    const value = { ...parsed, keyword: kw };
    webSearchCache.set(key, { value, expires: Date.now() + SEARCH_CACHE_TTL_MS });
    while (webSearchCache.size > 30) {
      const oldest = webSearchCache.keys().next().value;
      if (oldest) webSearchCache.delete(oldest);
      else break;
    }
    return value;
  } finally {
    cleanup();
  }
}

function parseAppSearchPayload(payload: any, page: number, keyword: string) {
  if (!payload || typeof payload !== "object") throw new Error("App 搜索返回空响应");
  if (Number(payload.code ?? 0) !== 0) throw new Error("App 搜索返回业务错误");
  const tabs = Array.isArray(payload.search_tabs) ? payload.search_tabs : payload.data?.search_tabs;
  if (!Array.isArray(tabs)) throw new Error("App 搜索数据结构异常");
  const tab = tabs.find((item: any) => Number(item?.tab_type) === 11);
  if (!tab) throw new Error("App 搜索暂未返回短剧结果");
  const seen = new Set<string>();
  const results: any[] = [];
  for (const cell of Array.isArray(tab.data) ? tab.data : []) {
    const video = (Array.isArray(cell?.video_data) ? cell.video_data : []).find((item: any) =>
      /^\d{1,30}$/.test(String(item?.series_id || "")),
    );
    if (!video) continue;
    const seriesId = String(video.series_id);
    const title = cleanTitle(cell?.search_high_light?.title?.text || video.title || cell?.cell_name || "");
    if (!title || seen.has(seriesId)) continue;
    seen.add(seriesId);
    if (
      !matchesSearchKeyword(
        keyword,
        title,
        video?.series_intro,
        video?.video_desc,
        cell?.series_intro,
        video?.tags,
        video?.category_list,
        video?.celebrities,
        cell?.search_high_light,
      )
    ) {
      continue;
    }
    results.push({
      series_id: seriesId,
      series_title: title,
      cover: appCover(video?.cover),
      episode_count: Number(video?.episode_cnt ?? video?.episode_count ?? 0) || 0,
      description: cleanTitle(video?.series_intro || video?.video_desc || cell?.series_intro || ""),
      source: "hongguo",
      url: `${SITE_ORIGIN}/detail?series_id=${seriesId}`,
    });
  }
  const hasMore = results.length > 0 && tab.has_more === true && page < 50;
  return {
    success: true,
    results,
    page,
    total: 0,
    totalPages: 0,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    channel: "app",
    cursor: {
      search_id: String(tab.search_id || ""),
      passback: String(tab.passback || ""),
      next_offset: parseSearchInteger(tab.next_offset),
    },
  };
}

export async function searchHongguoDramas(keyword: string, page = 1) {
  if (!keyword) return { results: [], total: 0, page: 1, hasMore: false };
  const cleanKw = String(keyword).trim();
  if (!cleanKw || cleanKw.length > 80) {
    throw Object.assign(new Error("搜索词需为 1 至 80 字的文本"), { status: 400 });
  }
  const pg = Number(page);
  if (!Number.isInteger(pg) || pg < 1 || pg > 50) {
    throw Object.assign(new Error("页码需为 1 至 50 的整数"), { status: 400 });
  }

  try {
    const webRes = await searchWeb(cleanKw, pg);
    if (webRes && Array.isArray(webRes.results)) return webRes;
  } catch {
    // Fall back to signed App search
  }

  let session = appSearchSessions.get(cleanKw);
  if (pg === 1 || !session || session.expires <= Date.now()) {
    session = { expires: Date.now() + 120000, cursors: new Map() };
    appSearchSessions.delete(cleanKw);
    appSearchSessions.set(cleanKw, session);
    if (appSearchSessions.size > 30) {
      const oldest = appSearchSessions.keys().next().value;
      if (oldest) appSearchSessions.delete(oldest);
    }
  }
  const deadline = Date.now() + 8000;
  const identity = await getPlaybackDevice(requestJson);
  const signed = signedSearchRequest({ keyword: cleanKw, page: pg, cursor: session.cursors.get(pg), identity });
  const payload = await requestJson(signed.url, { method: "GET", headers: signed.headers }, deadline);
  const appRes = parseAppSearchPayload(payload, pg, cleanKw);
  if (appRes.hasMore && appRes.cursor) session.cursors.set(pg + 1, appRes.cursor);
  return appRes;
}

// ── Series Detail & Episode List (`hongguo.js` web router + App fallback) ────

function readRouterData(html: string): any {
  const match = String(html).match(/(?:window\.)?_ROUTER_DATA\s*=\s*(\{)/);
  if (!match || match.index === undefined) {
    throw new Error("来源页面未返回目录数据，请重试或打开来源页面");
  }
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}" && --depth === 0) {
      return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error("来源目录数据不完整，请重试");
}

function parseEpisodeListHtml(html: string, seriesId: string) {
  const router = readRouterData(html);
  const data =
    router.loaderData?.["player_(series_id)/page"] ??
    router.loaderData?.["player_(series_id)/(vid)/page"] ??
    router.loaderData?.detail_page;
  const detail = data?.seriesDetail;
  if (
    !data ||
    data.isSuccess === false ||
    !/^\d{1,30}$/.test(String(detail?.series_id || "")) ||
    String(detail.series_id) !== String(seriesId) ||
    (data.series_id != null && String(data.series_id) !== String(seriesId))
  ) {
    throw new Error("官网返回的剧集与请求不一致或缺少剧集身份");
  }
  if (!Array.isArray(detail.vid_list)) throw new Error("官网页面未找到分集数据（vid_list）");
  const vids = detail.vid_list.map(String);
  if (vids.some((vid: string) => !/^\d{1,30}$/.test(vid)) || new Set(vids).size !== vids.length) {
    throw new Error("官网分集数据异常");
  }
  if (!vids.length) throw new Error("官网分集列表为空");

  const seriesTitle = typeof detail.series_name === "string" ? detail.series_name : "未命名短剧";
  const cover = typeof detail.series_cover === "string" ? detail.series_cover : "";
  const episodes = vids.map((vid: string, i: number) => ({
    vid,
    vid_index: i + 1,
    title: `第 ${i + 1} 集`,
    series_id: String(seriesId),
    series_title: seriesTitle,
    cover,
  }));

  const intro = typeof detail.series_intro === "string" ? detail.series_intro.trim() : "";
  const tags = Array.isArray(detail.tags) ? detail.tags.map((t: unknown) => String(t).trim()).filter(Boolean) : [];
  const episode_label = typeof detail.episode_right_text === "string" ? detail.episode_right_text.trim() : "";
  const celebrities = Array.isArray(detail.celebrities)
    ? detail.celebrities
        .filter((c: any) => c && !c.is_label && (c.nickname || c.name))
        .map((c: any) => ({
          actor_id: String(c.celebrity_id || c.actor_id || ""),
          name: String(c.nickname || c.name || "").trim(),
          avatar: typeof c.avatar === "string" ? c.avatar : "",
          role: String(c.sub_title || c.role || "").trim(),
        }))
    : [];
  const social_info = data?.seriesSocialInfo
    ? {
        rating: data.seriesSocialInfo.rating ? String(data.seriesSocialInfo.rating) : "",
        hot_text: data.seriesSocialInfo.hot_score_data?.text || "",
        like_count: data.seriesSocialInfo.series_like_count ? String(data.seriesSocialInfo.series_like_count) : "",
      }
    : undefined;

  return {
    series_id: String(seriesId),
    series_title: seriesTitle,
    cover: cover || (episodes[0] && episodes[0].cover) || "",
    total: episodes.length,
    episodes,
    intro,
    tags,
    episode_label,
    social_info,
    celebrities,
  };
}

async function fetchEpisodeListFromWeb(seriesId: string) {
  const id = String(seriesId);
  const race = async (timeoutMs: number) => {
    const controller = new AbortController();
    const attempts = [
      fetchSiteHtml(`${SITE_ORIGIN}/player/${encodeURIComponent(id)}`, timeoutMs, controller.signal),
      fetchSiteHtml(`${SITE_ORIGIN}/detail?series_id=${encodeURIComponent(id)}`, timeoutMs, controller.signal),
    ].map((p) => p.then((html) => parseEpisodeListHtml(html, id)));
    attempts.forEach((p) => p.catch(() => {}));
    try {
      return await Promise.any(attempts);
    } finally {
      controller.abort();
    }
  };

  let firstValue: any = null;
  const first = race(2000).then((val) => {
    firstValue = val;
    return val;
  });
  const hedge = (async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
    if (firstValue) return firstValue;
    return race(4500);
  })();
  return Promise.any([first, hedge]);
}

const API_HOST = "https://api5-normal-sinfonlineb.fqnovel.com";
const LEGACY_API_UA =
  "com.phoenix.read/71532 (Linux; U; Android 9; SM-N9860; Build/PQ3A.190705.10241111;tt-ok/3.12.13.20)";
const DETAIL_BIZ_PARAM = {
  detail_page_version: 0,
  disable_digg_stat: false,
  image_shrink_datas_str:
    "W3siaW1hZ2VfdHlwZSI6MywiaW1hZ2Vfd2lkdGgiOjkwMCwic2hyaW5rX3R5cGUiOjN9LHsiaW1hZ2VfdHlwZSI6NCwiaW1hZ2Vfd2lkdGgiOjcyLCJzaHJpbmtfdHlwZSI6NH1d\n",
  need_all_video_definition: false,
  need_mp4_align: false,
  screen_width_px: "900",
  source: 7,
  use_os_player: false,
  use_server_dns: false,
};

const seriesDetailApiCache = new Map<string, { value: any; expires: number }>();

export async function fetchHongguoSeriesDetail(seriesId: string) {
  const sid = String(seriesId || "").trim();
  if (!/^\d{1,30}$/.test(sid)) throw Object.assign(new Error("剧集编号无效"), { status: 400 });

  const cached = seriesDetailApiCache.get(sid);
  if (cached && cached.expires > Date.now()) return cached.value;

  let result: any;
  try {
    result = await fetchEpisodeListFromWeb(sid);
  } catch (webErr: any) {
    const query = new URLSearchParams({
      ac: "wifi",
      channel: "oppo_8662_64",
      aid: "8662",
      app_name: "novelread",
      version_code: "71532",
      version_name: "7.1.5.32",
      device_platform: "android",
      os: "android",
      _rticket: String(Date.now()),
    }).toString();
    const payload = JSON.stringify({
      biz_param: DETAIL_BIZ_PARAM,
      dr_scene: "preload",
      series_id: sid,
    });
    const j = await requestJson(
      `${API_HOST}/novel/player/multi_video_detail/preload/v1?${query}`,
      {
        method: "POST",
        headers: {
          "User-Agent": LEGACY_API_UA,
          Accept: "application/json; charset=utf-8",
          "Content-Type": "application/json; charset=utf-8",
        },
        data: payload,
      },
      Date.now() + 15000,
    );
    if (!j || j.code !== 0) {
      throw new Error(`获取分集失败：官网数据源（${webErr?.message || "不可用"}）`);
    }
    const d = j.data || {};
    if (!Object.prototype.hasOwnProperty.call(d, sid)) {
      throw new Error("备用接口返回的剧集与请求不一致");
    }
    const vd = d[sid]?.video_data || {};
    const vl = Array.isArray(vd.video_list) ? vd.video_list : [];
    const episodes = vl
      .map((item: any) => ({
        vid: String(item.vid),
        vid_index: Number(item.vid_index) || 0,
        title: item.title ? String(item.title) : `第 ${item.vid_index} 集`,
        series_id: sid,
        series_title: vd.series_title || "",
        cover: vd.series_cover || vd.cover_url || item.cover_url || "",
      }))
      .sort((a: any, b: any) => a.vid_index - b.vid_index);
    if (!episodes.length) throw new Error("未获取到该短剧的分集列表");
    result = {
      series_id: sid,
      series_title: vd.series_title || "未命名短剧",
      cover: vd.series_cover || vd.cover_url || episodes[0].cover || "",
      total: episodes.length,
      intro: "",
      tags: [],
      celebrities: [],
      episodes,
    };
  }

  seriesDetailApiCache.set(sid, { value: result, expires: Date.now() + 60000 });
  while (seriesDetailApiCache.size > 64) {
    const oldest = seriesDetailApiCache.keys().next().value;
    if (oldest) seriesDetailApiCache.delete(oldest);
    else break;
  }
  return result;
}

// ── Actor Rankings & Profiles (`hongguo-actor`) ──────────────────────────────

const KNOWN_FEMALE_ACTORS = new Set([
  "王志欣", "王小亿", "何雅馨", "至春禾", "张晋宜", "余茵", "郭宇欣", "董薇", "丁磊", "郇依心",
  "孟娜", "林秋奈", "羽翎", "马乐婕", "马秋元", "谭盐盐", "韩雨彤", "黄宁馨", "高子怡", "梁雯晶",
  "袁祎晴", "黎晟萱", "刘念", "袁子晶", "翟一莹", "贾翼瑄", "钟熙", "斯佳丽", "柴慧琴", "滕泽文",
  "孙芊芊", "许梦圆", "赵夕汐", "徐艺真", "赵佳", "张楚萱", "侯呈玥", "黄云云", "刘美娜", "邓灵枢",
  "孙艺燃", "张嘉妤", "陈淑云", "李偌菡", "琪梵", "索菲", "天儿", "姜熙饶", "何雨桐", "方梨",
  "苏曼", "董洁", "涂蕊", "杨泽琳", "冯艺然", "周洛伊", "裴颤", "李柯以", "林琦婷", "蒋昕妍",
  "赵慧楠", "朱诗妤", "胡冬晴",
]);
const KNOWN_MALE_ACTORS = new Set([
  "申浩男", "柯淳", "鹿单东", "白方文", "岳冬峰", "严子贤", "孙樾", "曾辉", "舒童",
  "王凯沐", "梁思伟", "张翅", "李世鑫", "卡戎", "程宇峰", "沉思", "蔡欣洋", "时康", "王皓祯",
  "代高政", "姚冠宇", "刘安歌", "刘润铭", "魏尊", "尤洋", "王培延", "马瑞泽", "陈俊儒", "魏华",
  "赵振栋", "刘萧旭", "皮德胜", "杜培源", "鞠振涛", "郭勐", "诸葛迪迪", "李芮", "杨泠铸", "徐金海",
  "孙明文", "任飞跃", "张子唯", "黄旭高", "曾祥羽", "徐成刚", "徐云龙", "王猛", "刘国际", "钟世岩",
  "张振宇", "徐卫龙", "王永新", "宋敬伟", "孙启鑫", "宋金阳", "孙一平", "董勋辉", "张震", "王嘉皓",
  "郑国锋", "李军", "徐大宁", "张正", "李京雨", "乔狄", "张铭祥", "户元松", "何红华", "冷海铭",
  "楚晓龙", "晟铭", "商泽华", "吴昊", "罗大涛", "刘昱辰", "王嘉禾", "陈宇星", "李腾", "叶新龙",
  "祝贺", "王梓豪", "余嘉政", "李治源", "艺丰", "张辉", "张海峰", "潘俊", "廖峰", "汪奇",
  "杨灿", "易浩铭", "六子", "谭鑫", "范少雄",
]);

const ACTOR_CACHE_TTL_MS = 900000;
const ACTOR_WORKS_TTL_MS = 300000;
const actorSessions = new Map<string, any>();
const actorWorksCache = new Map<string, { rawVideos: any[]; totalCount: number; hasMore: boolean; expiresAt: number }>();

function inferActorGender(actor: { name?: string; intro?: string }): "female" | "male" {
  const name = actor.name || "";
  if (KNOWN_FEMALE_ACTORS.has(name)) return "female";
  if (KNOWN_MALE_ACTORS.has(name)) return "male";
  const intro = actor.intro || "";
  if (/(?:中国|内地)?女演员|女艺人|女歌手|女模/.test(intro)) return "female";
  if (/(?:中国|内地)?男演员|男艺人|男歌手|男模/.test(intro)) return "male";
  return "female";
}

function learnActorGender(name: string, intro: string): void {
  if (!name || !intro) return;
  if (/(?:中国|内地)?女演员|女艺人|女歌手|女模/.test(intro)) {
    if (!KNOWN_FEMALE_ACTORS.has(name) || KNOWN_MALE_ACTORS.has(name)) {
      KNOWN_MALE_ACTORS.delete(name);
      KNOWN_FEMALE_ACTORS.add(name);
      actorSessions.clear();
    }
  } else if (/(?:中国|内地)?男演员|男艺人|男歌手|男模/.test(intro)) {
    if (!KNOWN_MALE_ACTORS.has(name) || KNOWN_FEMALE_ACTORS.has(name)) {
      KNOWN_FEMALE_ACTORS.delete(name);
      KNOWN_MALE_ACTORS.add(name);
      actorSessions.clear();
    }
  }
}

function parseActorRankingPayload(payload: any, pageNum: number, pageLimit: number, activeSession: any) {
  if (!payload || payload.code !== 0) {
    throw Object.assign(new Error(payload?.message || "获取剧星榜失败"), { status: 502 });
  }
  const cellView = payload.data?.cell_view;
  if (!cellView || !Array.isArray(cellView.cell_data)) {
    throw Object.assign(new Error("剧星榜返回结构异常"), { code: "ACTOR_SCHEMA_ERROR", status: 502 });
  }
  let rankDate = "";
  if (cellView.cell_data_json) {
    try {
      rankDate = JSON.parse(cellView.cell_data_json).rank_list_date || "";
    } catch {
      rankDate = "";
    }
  }
  if (!rankDate && activeSession?.rankDate) rankDate = activeSession.rankDate;

  const rawList = cellView.cell_data.flatMap((cell: any) => cell.ugc_user_data || []);
  const actors = rawList
    .map((item: any, idx: number) => {
      const baseInfo = item.user_info?.base_info || {};
      const actor_id = String(baseInfo.actor_id_str || "");
      const name = cleanTitle(baseInfo.user_name || "");
      const intro = cleanTitle(item.intro || "");
      const changeData = item.rank_change_data || {};
      return {
        rank: (pageNum - 1) * pageLimit + idx + 1,
        actor_id,
        user_id: String(item.user_info?.user_id || ""),
        name,
        avatar: actorCover(baseInfo.user_avatar),
        gender: inferActorGender({ name, intro }),
        score: item.rec_text_item?.RecommendText || "",
        intro,
        sub_titles: (item.sub_title_list || []).map((s: any) => cleanTitle(s.content)).filter(Boolean),
        rank_change: {
          type: changeData.rank_change_type === 1 || changeData.rank_change_type === 2 ? changeData.rank_change_type : 0,
          num: changeData.ChangeNum || 0,
        },
      };
    })
    .filter((a: any) => a.actor_id && a.name);

  return {
    actors,
    rankDate,
    hasMore: !!payload.data?.has_more,
    nextOffset: payload.data?.next_offset,
    sessionId: payload.data?.session_id || "",
  };
}

export async function fetchHongguoActorRankings({
  page = 1,
  limit = 20,
  gender = "all",
}: {
  page?: number;
  limit?: number;
  gender?: string;
} = {}): Promise<any> {
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const pageLimit = Math.max(1, Math.min(50, parseInt(String(limit), 10) || 20));
  const validGender = ["male", "female"].includes(String(gender).toLowerCase())
    ? String(gender).toLowerCase()
    : "all";
  const now = Date.now();

  for (const [k, sess] of [...actorSessions.entries()]) {
    if (sess.expiresAt <= now) actorSessions.delete(k);
  }
  const sessionKey = `${pageLimit}_${validGender}`;

  if (validGender !== "all") {
    let genderSession = actorSessions.get(sessionKey);
    if (!genderSession || genderSession.expiresAt <= now) {
      genderSession = {
        limit: pageLimit,
        gender: validGender,
        expiresAt: now + ACTOR_CACHE_TTL_MS,
        pool: [],
        upstreamPage: 0,
        upstreamHasMore: true,
        rankDate: "",
      };
      actorSessions.set(sessionKey, genderSession);
    }

    const neededCount = pageNum * pageLimit;
    let scanPages = 0;
    while (genderSession.pool.length < neededCount && genderSession.upstreamHasMore && scanPages < 15) {
      scanPages++;
      const nextUpstreamPage = genderSession.upstreamPage + 1;
      let upstreamRes: any;
      try {
        upstreamRes = await fetchHongguoActorRankings({ page: nextUpstreamPage, limit: 50, gender: "all" });
      } catch (err: any) {
        if (err?.code === "ACTOR_PAGE_OVERFLOW" || err?.code === "ACTOR_SCHEMA_ERROR") {
          genderSession.upstreamHasMore = false;
          break;
        }
        throw err;
      }
      genderSession.upstreamPage = nextUpstreamPage;
      if (!genderSession.rankDate && upstreamRes.rank_date) genderSession.rankDate = upstreamRes.rank_date;
      if (!upstreamRes.actors?.length || !upstreamRes.has_more) genderSession.upstreamHasMore = false;
      for (const actor of upstreamRes.actors || []) {
        if (actor.gender === validGender && !genderSession.pool.some((a: any) => a.actor_id === actor.actor_id)) {
          genderSession.pool.push(actor);
        }
      }
      if (!upstreamRes.has_more || !upstreamRes.actors?.length) break;
    }

    const startIndex = (pageNum - 1) * pageLimit;
    const pageActors = genderSession.pool.slice(startIndex, startIndex + pageLimit);
    const hasMore = genderSession.pool.length > startIndex + pageLimit || genderSession.upstreamHasMore;
    if (pageNum > 1 && pageActors.length === 0) {
      throw Object.assign(new Error("已到达榜单末尾，无更多演员数据"), { code: "ACTOR_PAGE_OVERFLOW", status: 400 });
    }
    return {
      success: true,
      actors: pageActors,
      rank_date: genderSession.rankDate,
      page: pageNum,
      limit: pageLimit,
      gender: validGender,
      has_more: hasMore,
      total: pageActors.length,
    };
  }

  let session = actorSessions.get(sessionKey);
  if (session && session.expiresAt > now && session.pages.has(pageNum)) {
    const cached = session.pages.get(pageNum);
    return {
      success: true,
      actors: cached.actors,
      rank_date: cached.rankDate,
      page: pageNum,
      limit: pageLimit,
      gender: "all",
      has_more: cached.hasMore,
      total: cached.actors.length,
    };
  }

  if (pageNum > 1 && (!session || session.expiresAt <= now || !session.pageOffsets?.has(pageNum))) {
    if (!session || session.expiresAt <= now) actorSessions.delete(sessionKey);
    for (let p = 1; p < pageNum; p++) {
      const stepRes = await fetchHongguoActorRankings({ page: p, limit: pageLimit, gender: "all" });
      if (!stepRes.has_more) {
        throw Object.assign(new Error("已到达榜单末尾，无更多演员数据"), { code: "ACTOR_PAGE_OVERFLOW", status: 400 });
      }
    }
    session = actorSessions.get(sessionKey);
  }

  const values: Record<string, string> =
    pageNum === 1 || !session
      ? {
          tab_type: "26",
          client_req_type: "2",
          client_template: "2",
          cell_id: "7470092475068071998",
          cell_sub_id: "0",
          selected_items: "ranklist_celebrity",
          sub_selected_items: "ranklist_series_actor",
          category_id: "0",
          gender: "2",
          limit: String(pageLimit),
          offset: "0",
          session_id: "",
          background_selected_items: "",
          panel_selected_items: "",
          filter_ids: "",
          unlimited_selector_change_type: "0",
        }
      : {
          tab_type: "18",
          client_req_type: "2",
          client_template: "2",
          cell_id: "7470092475068071998",
          cell_sub_id: "0",
          selected_items: "ranklist_celebrity",
          sub_selected_items: "ranklist_series_actor",
          category_id: "0",
          gender: "2",
          limit: String(pageLimit),
          offset: String(session.pageOffsets?.get(pageNum) ?? (pageNum - 1) * pageLimit),
          session_id: session.sessionId || "",
          background_selected_items: "",
          panel_selected_items: "",
          filter_ids: "",
          unlimited_selector_change_type: "0",
        };

  const signed = signedMetadataRequest("/reading/bookapi/bookmall/cell/change/v", values);
  let payload = await requestJson(signed.url, { method: "GET", headers: signed.headers }, Date.now() + 15000);
  let parsed: ReturnType<typeof parseActorRankingPayload>;
  try {
    parsed = parseActorRankingPayload(payload, pageNum, pageLimit, session);
  } catch (err: any) {
    if (err?.code === "ACTOR_SCHEMA_ERROR" && pageNum === 1) {
      await new Promise<void>((r) => setTimeout(r, 400));
      const retry = signedMetadataRequest("/reading/bookapi/bookmall/cell/change/v", values);
      payload = await requestJson(retry.url, { method: "GET", headers: retry.headers }, Date.now() + 15000);
      parsed = parseActorRankingPayload(payload, pageNum, pageLimit, session);
    } else {
      throw err;
    }
  }

  if (!session || pageNum === 1) {
    session = {
      limit: pageLimit,
      gender: "all",
      sessionId: parsed.sessionId,
      nextOffset: parsed.nextOffset,
      rankDate: parsed.rankDate,
      expiresAt: Date.now() + ACTOR_CACHE_TTL_MS,
      pages: new Map(),
      pageOffsets: new Map([[1, 0]]),
    };
    actorSessions.set(sessionKey, session);
  } else {
    session.nextOffset = parsed.nextOffset;
    if (parsed.sessionId) session.sessionId = parsed.sessionId;
  }
  if (parsed.nextOffset !== undefined) {
    session.pageOffsets.set(pageNum + 1, parsed.nextOffset);
  }
  session.pages.set(pageNum, { actors: parsed.actors, rankDate: parsed.rankDate, hasMore: parsed.hasMore });
  return {
    success: true,
    actors: parsed.actors,
    rank_date: parsed.rankDate,
    page: pageNum,
    limit: pageLimit,
    gender: "all",
    has_more: parsed.hasMore,
    total: parsed.actors.length,
  };
}

function mapVideoToWork(v: any) {
  const match = String(v.sub_title || "").match(/(\d+)\s*集/);
  return {
    series_id: String(v.series_id || ""),
    series_title: cleanTitle(v.title || ""),
    cover: actorCover(v.cover),
    episode_count: Number(v.episode_cnt) || (match ? parseInt(match[1], 10) : 0),
    sub_title: cleanTitle(v.sub_title || ""),
    rec_text: v.rec_text || "",
    score: v.score || "",
    description: cleanTitle(v.video_desc || ""),
    duration: Number(v.duration) || 0,
    source: "hongguo",
  };
}

async function fetchActorWorksPage(cleanId: string, reqOffset: number, reqCount: number) {
  const cached = actorWorksCache.get(cleanId);
  const now = Date.now();
  if (
    cached &&
    cached.expiresAt > now &&
    (cached.rawVideos.length >= reqOffset + reqCount || !cached.hasMore || cached.rawVideos.length >= cached.totalCount)
  ) {
    const paged = cached.rawVideos.slice(reqOffset, reqOffset + reqCount);
    const works = paged.map(mapVideoToWork).filter((w) => w.series_id && w.series_title);
    return {
      works,
      has_more: works.length > 0 && reqOffset + works.length < cached.totalCount,
    };
  }

  const targetCount = Math.min(300, Math.max(reqOffset + reqCount, 40));
  const signed = signedMetadataRequest("/reading/user/celebrity/works/v1/", {
    encrypted_celebrity_ids: cleanId,
    offset: String(reqOffset),
    count: String(targetCount),
    req_scene: "0",
  });
  const payload = await requestJson(signed.url, { method: "GET", headers: signed.headers }, Date.now() + 15000);
  if (!payload || payload.code !== 0) {
    throw Object.assign(new Error(payload?.message || "获取演员作品失败"), { status: 502 });
  }
  const actorWorkData = payload.data?.works?.[cleanId] || {};
  const rawVideos = Array.isArray(actorWorkData.video_list) ? actorWorkData.video_list : [];
  const totalCount = Number(actorWorkData.total_count) || rawVideos.length;
  const hasMore = !!actorWorkData.has_more && rawVideos.length < totalCount;
  actorWorksCache.set(cleanId, { rawVideos, totalCount, hasMore, expiresAt: now + ACTOR_WORKS_TTL_MS });

  const paged = rawVideos.slice(reqOffset, reqOffset + reqCount);
  const works = paged.map(mapVideoToWork).filter((w: any) => w.series_id && w.series_title);
  return {
    works,
    has_more: works.length > 0 && reqOffset + works.length < totalCount,
  };
}

export async function fetchHongguoActorDetail(actorId: string) {
  const cleanId = String(actorId || "").trim();
  if (!/^\d{1,30}$/.test(cleanId)) {
    throw Object.assign(new Error("无效的演员 ID"), { status: 400 });
  }
  const detailReq = signedMetadataRequest("/reading/user/celebrity/homepage/v1/", {
    encrypted_celebrity_id: cleanId,
  });
  const [detailPayload, firstWorks] = await Promise.all([
    requestJson(detailReq.url, { method: "GET", headers: detailReq.headers }, Date.now() + 15000),
    fetchActorWorksPage(cleanId, 0, 50),
  ]);
  if (!detailPayload || detailPayload.code !== 0 || !detailPayload.data?.celebrity_info) {
    throw Object.assign(new Error("未查询到该演员信息"), { status: 404 });
  }
  const info = detailPayload.data.celebrity_info;
  learnActorGender(info.nickname, info.intro);
  const related = (info.related_celebrities || [])
    .map((r: any) => ({
      actor_id: String(r.celebrity_id || ""),
      name: cleanTitle(r.nickname || ""),
      avatar: actorCover(r.avatar),
      intro: cleanTitle(r.intro || ""),
    }))
    .filter((r: any) => r.actor_id && r.name);

  const works = [...firstWorks.works];
  const ids = new Set(works.map((w) => w.series_id));
  let more = firstWorks.has_more;
  while (more && works.length < 2500) {
    const page = await fetchActorWorksPage(cleanId, works.length, 50);
    const fresh = page.works.filter((w: { series_id: string }) => !ids.has(w.series_id));
    if (!fresh.length) break;
    for (const item of fresh) ids.add(item.series_id);
    works.push(...fresh);
    more = page.has_more;
  }

  return {
    actor: {
      actor_id: cleanId,
      name: cleanTitle(info.nickname || ""),
      avatar: actorCover(info.avatar),
      intro: cleanTitle(info.intro || ""),
      celebrity_type: info.celebrity_type || 1,
      related_celebrities: related,
    },
    works,
  };
}

// ── Official Timeline Danmaku (`danmaku.js`) ─────────────────────────────────

const COMMENT_BASE_URL = "https://api5-normal-sinfonlineb.fqnovel.com";
const COMMENT_UA =
  "com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)";
const MAX_DANMAKU_ITEMS = 3000;
const DANMAKU_CACHE_OK_MS = 5 * 60 * 1000;
const DANMAKU_CACHE_FAIL_MS = 15 * 1000;

const danmakuCache = new Map<string, { expires: number; result: any }>();
const danmakuPending = new Map<string, Promise<any>>();
let fallbackDanmakuDevice: { deviceId: string; installId: string } | null = null;

async function resolveDanmakuDevice(): Promise<{ deviceId: string; installId: string }> {
  try {
    const reg = await getPlaybackDevice(requestJson);
    if (reg?.device_id && reg?.iid) {
      return { deviceId: reg.device_id, installId: reg.iid };
    }
  } catch {
    // Fall back to anonymous local IDs if device registration fails
  }
  fallbackDanmakuDevice ||= { deviceId: newDeviceId(), installId: newDeviceId() };
  return fallbackDanmakuDevice;
}

function cleanDanmakuText(text: string): string {
  let out = "";
  for (const char of String(text)) {
    const code = char.codePointAt(0) || 0;
    out += code < 0x20 || code === 0x7f || char === "\u2028" || char === "\u2029" ? " " : char;
  }
  return out.trim();
}

function parseDanmakuPage(payload: any, vid: string) {
  const empty = { items: [] as any[], nextMs: null as number | null, hasMore: null as boolean | null, cursor: "" };
  const data = payload?.data;
  if (!data || typeof data !== "object") return empty;
  const rows = Array.isArray(data.data_list) ? data.data_list : [];
  let nextMs: number | null = null;
  let hasMore: boolean | null = null;
  let rawCursor = "";

  const extra = data.extra;
  if (extra && typeof extra === "object") {
    const raw = String(extra.next_query_danmaku_list_time ?? "").trim();
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) nextMs = parsed;
    }
  }

  const info = data.common_list_info;
  if (info && typeof info === "object") {
    if (typeof info.cursor === "string") rawCursor = info.cursor;
    const flag = info.has_more;
    if (typeof flag === "boolean") hasMore = flag;
    else if (typeof flag === "string") hasMore = ["1", "true", "yes"].includes(flag.trim().toLowerCase());
    else if (flag != null) hasMore = !["0", "false", "no"].includes(String(flag));

    let cursorObj = info.cursor;
    if (typeof cursorObj === "string" && cursorObj.trim().startsWith("{")) {
      try {
        cursorObj = JSON.parse(cursorObj);
      } catch {
        cursorObj = null;
      }
    }
    if (cursorObj && typeof cursorObj === "object") {
      for (const k of ["end_offset_time", "next_offset_time", "offset"]) {
        const candidate = Number.parseInt(cursorObj[k], 10);
        if (!Number.isFinite(candidate)) continue;
        if (nextMs === null || candidate > nextMs) nextMs = candidate;
        break;
      }
    }
  }
  if (hasMore === false) nextMs = null;

  const items: any[] = [];
  for (const raw of rows) {
    const comment = raw?.comment;
    if (!comment || typeof comment !== "object") continue;
    const common = comment.common && typeof comment.common === "object" ? comment.common : {};
    const groupId = common.group_id != null ? String(common.group_id) : "";
    if (groupId && groupId !== vid) continue;
    if (String(common.status ?? "") !== "1") continue;
    const text = String(common.content?.text ?? "");
    const expand = comment.expand && typeof comment.expand === "object" ? comment.expand : {};
    const timeRaw = expand.offset_time ?? comment.offset_time;
    const count = Number(comment.stat?.digg_count);
    const likes = Number.isSafeInteger(count) && count >= 0 ? count : 0;
    items.push({ text, timeRaw, likes });
  }
  if (nextMs !== null && nextMs <= 0) nextMs = null;
  return { items, nextMs, hasMore, cursor: rawCursor };
}

export async function fetchHongguoDanmaku(
  seriesId: string,
  vid: string,
): Promise<{ success: boolean; items: { time: number; text: string; likes: number }[] }> {
  const sid = String(seriesId || "").trim();
  const episodeVid = String(vid || "").trim();
  if (!/^\d{6,30}$/.test(sid) || !/^\d{6,30}$/.test(episodeVid)) {
    return { success: false, items: [] };
  }

  const cacheKey = `${sid}:${episodeVid}`;
  const hit = danmakuCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.result;
  const inflight = danmakuPending.get(cacheKey);
  if (inflight) return inflight;

  const task = (async () => {
    const collected: { time: number; text: string; likes: number }[] = [];
    const seen = new Set<string>();
    let start = 0;
    let duration = 3600000;
    let cursor = "";
    let emptyPages = 0;
    let failed = false;

    try {
      const device = await resolveDanmakuDevice();
      for (let page = 0; page < 40; page++) {
        if (page > 0) await new Promise<void>((resolve) => setTimeout(resolve, 120));
        const stampMs = Date.now();
        const stamp = Math.floor(stampMs / 1000);
        const nonce = crypto.randomBytes(NONCE_BYTES);
        const rawQuery = buildQuery({ stampMs, deviceId: device.deviceId, installId: device.installId });
        const url = `${COMMENT_BASE_URL}/novel/commentapi/comment/list/${encodeURIComponent(episodeVid)}/v1/?${rawQuery}`;
        const body = JSON.stringify({
          comment_source: 601,
          server_channel: 1000,
          group_id: episodeVid,
          group_type: 30,
          comment_type: 20,
          sort: 1,
          count: 90,
          cursor,
          aid: 8662,
          compliance_status: 0,
          business_param: {
            book_id: sid,
            start_offset_time: start,
            playlet_item_duration: duration,
            need_danmaku_guide_type: [1, 3, 4, 2],
          },
        });
        const headers = {
          "User-Agent": COMMENT_UA,
          Accept: "application/json",
          "X-XS-From-Web": "0",
          "Sdk-Version": "2",
          "Content-Type": "application/json; charset=utf-8",
          "Comment-Source": "601",
          "Server-Channel": "1000",
          ...signCommentHeaders({ rawQuery, stamp, nonce }),
        };

        let payload: any;
        try {
          payload = await requestJson(url, { method: "POST", headers, data: body }, Date.now() + 20000);
        } catch {
          failed = collected.length === 0;
          break;
        }
        const code = payload?.code;
        if ((code !== 0 && code !== "0") || !Array.isArray(payload?.data?.data_list)) {
          failed = collected.length === 0;
          break;
        }

        const parsed = parseDanmakuPage(payload, episodeVid);
        if (parsed.cursor) cursor = parsed.cursor;
        if (parsed.items.length) emptyPages = 0;
        else emptyPages++;

        for (const item of parsed.items) {
          const num = Number(item.timeRaw);
          if (!Number.isFinite(num)) continue;
          const seconds = num / 1000;
          if (seconds < 0 || seconds > 604800) continue;
          const text = cleanDanmakuText(item.text);
          if (!text || text.length > 200) continue;
          const k = `${seconds.toFixed(3)}|${text}`;
          if (seen.has(k)) continue;
          seen.add(k);
          collected.push({ time: seconds, text, likes: item.likes });
          if (collected.length >= MAX_DANMAKU_ITEMS) break;
        }

        if (collected.length >= MAX_DANMAKU_ITEMS) break;
        if (parsed.nextMs === null || parsed.nextMs <= start || parsed.nextMs > 604800 * 1000) break;
        if (emptyPages >= 5 || page === 39) break;
        start = parsed.nextMs;
        duration = Math.min(Math.max(duration, start + 3600000), 24 * 60 * 60 * 1000);
      }
    } catch {
      failed = collected.length === 0;
    }

    collected.sort((a, b) => a.time - b.time);
    const result = { success: !failed, items: collected };
    danmakuCache.set(cacheKey, {
      expires: Date.now() + (failed ? DANMAKU_CACHE_FAIL_MS : DANMAKU_CACHE_OK_MS),
      result,
    });
    while (danmakuCache.size > 64) {
      const oldest = danmakuCache.keys().next().value;
      if (oldest) danmakuCache.delete(oldest);
      else break;
    }
    return result;
  })();

  danmakuPending.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (danmakuPending.get(cacheKey) === task) danmakuPending.delete(cacheKey);
  }
}

export { isPublicMediaUrl, baseParams };
