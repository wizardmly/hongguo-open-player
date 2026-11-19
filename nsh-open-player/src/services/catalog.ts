import { Picker, signal } from "nsh";
import avatar1 from "../../assets/avatars/avatar-1.png";
import avatar2 from "../../assets/avatars/avatar-2.png";
import avatar3 from "../../assets/avatars/avatar-3.png";
import avatar4 from "../../assets/avatars/avatar-4.png";
import poster1 from "../../assets/posters/poster-1.png";
import poster2 from "../../assets/posters/poster-2.png";
import poster3 from "../../assets/posters/poster-3.png";
import poster4 from "../../assets/posters/poster-4.png";
import poster5 from "../../assets/posters/poster-5.png";
import poster6 from "../../assets/posters/poster-6.png";
import clipHorizontal1 from "../../assets/videos/ep-horizontal-1.mp4";
import clipVertical1 from "../../assets/videos/ep-vertical-1.mp4";
import clipVertical2 from "../../assets/videos/ep-vertical-2.mp4";
import clipVertical3 from "../../assets/videos/ep-vertical-3.mp4";
import clipVertical4 from "../../assets/videos/ep-vertical-4.mp4";
import clipVertical5 from "../../assets/videos/ep-vertical-5.mp4";
import {
  aggregateRelatedSeasons,
  findMissingSeasonNumbers,
  parseSeasonInfo,
  toChineseSeasonQuery,
} from "../domain/seasons";
import type {
  ActorDetail,
  ActorSummary,
  CatalogTab,
  DanmakuComment,
  EpisodeItem,
  SeasonEntry,
  SeriesDetail,
  SeriesSummary,
} from "../domain/types";

const VERTICAL_CLIPS = [clipVertical1, clipVertical2, clipVertical3, clipVertical4, clipVertical5];
const POSTERS = [poster1, poster2, poster3, poster4, poster5, poster6];
const AVATARS = [avatar1, avatar2, avatar3, avatar4];

/** Exact hot search tags from `hongguo-open-player/src/client/js/app.js`. */
export const HOT_SEARCH_TAGS = ["离婚", "战神", "重生", "逆袭", "神医", "千金", "豪门", "甜宠"];

export interface PagedResult<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  total: number;
}

/**
 * Pluggable media source contract (`DramaSourceAdapter`).
 * All UI pages consume exclusively through this service layer so external backends or stream adapters
 * can be swapped in without modifying any presentation component.
 */
export interface DramaSourceAdapter {
  catalog(tab: CatalogTab, page: number): Promise<PagedResult<SeriesSummary>>;
  search(keyword: string, page: number): Promise<PagedResult<SeriesSummary>>;
  getSeriesDetail(seriesId: string): Promise<SeriesDetail>;
  getActorRanking(
    gender: "all" | "male" | "female",
    page: number,
  ): Promise<PagedResult<ActorSummary> & { rankDate: string }>;
  getActorDetail(actorId: string): Promise<ActorDetail>;
  getEpisodeDanmaku(vid: string, episodeIndex: number, seriesId?: string): Promise<DanmakuComment[]>;
}

let externalAdapter: DramaSourceAdapter | null = null;

/** Registers a custom `DramaSourceAdapter` implementation at runtime if needed. */
export function registerSourceAdapter(adapter: DramaSourceAdapter | null): void {
  externalAdapter = adapter;
  seasonsCache.clear();
  catalogPageCache.clear();
  actorPageCache.clear();
  seriesDetailCache.clear();
  seriesDetailInFlight.clear();
  danmakuCache.clear();
}

function buildEpisodes(
  seriesId: string,
  count: number,
  aspect: "vertical" | "horizontal" = "vertical",
): EpisodeItem[] {
  const list: EpisodeItem[] = [];
  for (let i = 1; i <= count; i++) {
    const src = aspect === "horizontal" ? clipHorizontal1 : VERTICAL_CLIPS[(i - 1) % VERTICAL_CLIPS.length];
    list.push({
      vid: `${seriesId}-ep-${i}`,
      vid_index: i,
      title: `第 ${i} 集`,
      duration_sec: 12,
      src,
      aspect,
      estimated_bytes: 900 * 1024,
    });
  }
  return list;
}

const ACTORS: ActorSummary[] = [
  {
    actor_id: "actor-101",
    name: "林清歌",
    gender: "female",
    rank: 1,
    rank_change: { type: 0 },
    avatar: AVATARS[0],
    score: "1055万人气",
    sub_titles: ["54部作品", "双周追剧627万人"],
    intro: "《万妖图录传第一季》《十八岁太奶驾到，重整家族荣耀第五部》《枝头春意闹》",
  },
  {
    actor_id: "actor-102",
    name: "沈知微",
    gender: "female",
    rank: 2,
    rank_change: { type: 1, num: 2 },
    avatar: AVATARS[1],
    score: "741万人气",
    sub_titles: ["19部作品", "双周追剧156万人"],
    intro: "《护女横扫魔域第二季》《别欺负小福宝，她能洞悉万物》《重生之都市甜宠》",
  },
  {
    actor_id: "actor-103",
    name: "陆行舟",
    gender: "male",
    rank: 3,
    rank_change: { type: 2, num: 1 },
    avatar: AVATARS[2],
    score: "715万人气",
    sub_titles: ["69部作品", "双周追剧312万人"],
    intro: "《装穷提亲，娶到全家嫌弃的她》《大唐憨婿之我姐姐是太子妃第五季》《一念沉沦》",
  },
  {
    actor_id: "actor-104",
    name: "韩雨彤",
    gender: "female",
    rank: 4,
    rank_change: { type: 1, num: 2 },
    avatar: AVATARS[0],
    score: "660万人气",
    sub_titles: ["42部作品", "双周追剧517万人"],
    intro: "《十八岁太奶驾到，重整家族荣耀第五部》《浮山书院奇谭》《甜桃烈酒》",
  },
  {
    actor_id: "actor-105",
    name: "时康",
    gender: "male",
    rank: 5,
    rank_change: { type: 0 },
    avatar: AVATARS[2],
    score: "612万人气",
    sub_titles: ["38部作品", "双周追剧284万人"],
    intro: "《九渊剑道修仙传第六季》《神医下山：豪门千金赖上我》《战神归来》",
  },
  {
    actor_id: "actor-106",
    name: "屈刚",
    gender: "male",
    rank: 6,
    rank_change: { type: 1, num: 1 },
    avatar: AVATARS[3],
    score: "580万人气",
    sub_titles: ["61部作品", "双周追剧198万人"],
    intro: "《大唐憨婿之我姐姐是太子妃第五季》《豪门家主风云录》《朝堂惊雷》",
  },
  {
    actor_id: "actor-107",
    name: "苏晚星",
    gender: "female",
    rank: 7,
    rank_change: { type: 2, num: 4 },
    avatar: AVATARS[1],
    score: "548万人气",
    sub_titles: ["27部作品", "双周追剧175万人"],
    intro: "《枝头春意闹》《星海折跃：大荒纪元》《离婚后前夫追悔莫及》",
  },
  {
    actor_id: "actor-108",
    name: "陈添祥",
    gender: "male",
    rank: 8,
    rank_change: { type: 0 },
    avatar: AVATARS[2],
    score: "519万人气",
    sub_titles: ["33部作品", "双周追剧162万人"],
    intro: "《万妖图录传》《逆袭之战神殿》《金吾卫夜行录》",
  },
];

// Build 9 seasons of 《万妖图录传》 (with Season 3 = 186 episodes exercising missing-season gap backfill).
const WANYAO_SEASONS: SeriesDetail[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((seasonNum) => {
  const cnNames = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const title = seasonNum === 1 ? "万妖图录传第一季" : `万妖图录传第${cnNames[seasonNum]}季`;
  const epCount = seasonNum === 1 ? 81 : seasonNum === 3 ? 186 : 72 + seasonNum * 12;
  const seriesId = `1000${seasonNum}`;
  return {
    series_id: seriesId,
    series_title: title,
    cover: POSTERS[0],
    episode_count: epCount,
    total: epCount,
    category: "comic-drama",
    tags: ["漫剧", `第${seasonNum}季`, "玄幻"],
    description: "以妖魔之血为墨，以百妖谱为卷，可摹画其形，夺其神通。姜月初觉醒万妖图录系统，逆伐大荒。",
    intro:
      "以妖血为墨、百妖谱为卷，可摹其形、夺其神通。姜月初穿越成大唐少女，觉醒万妖图录系统，借道行反杀鸣骨虎妖，踏上斩妖除魔、揭开百妖秘卷的热血逆袭之路。",
    social_info: {
      hot_text: `${4627 - (seasonNum - 1) * 180}万热度`,
      rating: (8.8 + (seasonNum % 3) * 0.2).toFixed(1),
      like_count: `${86 + seasonNum * 5}万`,
    },
    episodes: buildEpisodes(seriesId, epCount, "vertical"),
    celebrities: [
      { actor_id: "actor-101", name: "林清歌", role: "饰 姜月初", avatar: AVATARS[0] },
      { actor_id: "actor-108", name: "陈添祥", role: "饰 司命星君", avatar: AVATARS[2] },
    ],
  };
});

const FEATURED_SERIES: SeriesDetail[] = [
  WANYAO_SEASONS[0],
  {
    series_id: "20001",
    series_title: "和离后我带女儿横扫魔域第二季",
    cover: POSTERS[1],
    episode_count: 521,
    total: 521,
    category: "comic-drama",
    tags: ["漫剧", "第2季", "玄幻"],
    description: "陆清安走出旧日情缘，凭借神秘系统与非凡悟性，在强敌环伺的修行界护女逆袭。",
    intro: "离婚和离之后，陆清安携幼女隐居红枫谷，却因魔域异动重出江湖，一剑横扫八荒宗门。",
    social_info: { hot_text: "3890万热度", rating: "9.4", like_count: "72.4万" },
    episodes: buildEpisodes("20001", 521, "vertical"),
    celebrities: [
      { actor_id: "actor-102", name: "沈知微", role: "饰 云舒", avatar: AVATARS[1] },
      { actor_id: "actor-105", name: "时康", role: "饰 陆清安", avatar: AVATARS[2] },
    ],
  },
  {
    series_id: "20002",
    series_title: "装穷提亲，娶到全家嫌弃的她",
    cover: POSTERS[2],
    episode_count: 80,
    total: 80,
    category: "ai-drama",
    tags: ["AI剧", "豪门", "甜宠"],
    description: "顾承川装穷提亲，本想退掉爷爷定下的婚约，却被林家塞来不受待见的真千金。",
    intro: "豪门继承人顾承川隐瞒身份前往林家提亲，意外迎娶被全族冷落的林晚意，先婚后爱携手打脸逆袭。",
    social_info: { hot_text: "3410万热度", rating: "9.2", like_count: "64.1万" },
    episodes: buildEpisodes("20002", 80, "vertical"),
    celebrities: [
      { actor_id: "actor-103", name: "陆行舟", role: "饰 顾承川", avatar: AVATARS[2] },
      { actor_id: "actor-104", name: "韩雨彤", role: "饰 林晚意", avatar: AVATARS[0] },
    ],
  },
  {
    series_id: "20003",
    series_title: "大唐憨婿之我姐姐是太子妃第五季",
    cover: POSTERS[3],
    episode_count: 185,
    total: 185,
    category: "ai-drama",
    tags: ["AI剧", "第5季", "古装"],
    description: "因一桩和亲风波，苏昊大闹驿馆，将局面搅得翻天覆地，却化解了长安朝堂暗雷。",
    intro: "看似憨厚散漫的长安少年苏昊，实则胸藏韬略，在朝堂权谋与边关烽火间屡出奇招，战神风采尽显。",
    social_info: { hot_text: "3120万热度", rating: "9.3", like_count: "58.9万" },
    episodes: buildEpisodes("20003", 185, "vertical"),
    celebrities: [
      { actor_id: "actor-103", name: "陆行舟", role: "饰 苏昊", avatar: AVATARS[2] },
      { actor_id: "actor-106", name: "屈刚", role: "饰 魏国公", avatar: AVATARS[3] },
    ],
  },
  {
    series_id: "20004",
    series_title: "别欺负小福宝，她能洞悉万物",
    cover: POSTERS[5],
    episode_count: 80,
    total: 80,
    category: "real-drama",
    tags: ["真人剧", "神医", "甜宠"],
    description: "小女孩星星天生拥有透视万物的能力，在流浪中与小猫相依为命，直到豪门生父寻来。",
    intro: "天生灵瞳的小福宝不仅能识百草通神医之术，更能看穿人心善恶，回到豪门后成了全家团宠。",
    social_info: { hot_text: "2980万热度", rating: "9.5", like_count: "69.0万" },
    episodes: buildEpisodes("20004", 80, "vertical"),
    celebrities: [
      { actor_id: "actor-102", name: "沈知微", role: "饰 沈星眠", avatar: AVATARS[1] },
      { actor_id: "actor-106", name: "屈刚", role: "饰 老太爷", avatar: AVATARS[3] },
    ],
  },
  {
    series_id: "20005",
    series_title: "谁让这个文盲修仙的第六季",
    cover: POSTERS[4],
    episode_count: 220,
    total: 220,
    category: "comic-drama",
    tags: ["漫剧", "重生", "逆袭"],
    description: "不识仙门古篆的寒门少年，硬凭满级剑意把上古秘籍练成无敌神通。",
    intro: "重生归来的少年牧尘误读残卷，却歪打正着破开九渊剑冢禁制，一路越阶逆袭震动仙界。",
    social_info: { hot_text: "2760万热度", rating: "9.1", like_count: "51.2万" },
    episodes: buildEpisodes("20005", 220, "vertical"),
    celebrities: [
      { actor_id: "actor-105", name: "时康", role: "饰 牧尘", avatar: AVATARS[2] },
    ],
  },
  {
    series_id: "20006",
    series_title: "十八岁太奶驾到，重整家族荣耀",
    cover: POSTERS[2],
    episode_count: 102,
    total: 102,
    category: "real-drama",
    tags: ["真人剧", "重生", "豪门"],
    description: "老祖宗一朝重生回到十八岁芳华，亲自整顿不肖子孙，重振百年世家声威。",
    intro: "容氏家族危在旦夕之际，太奶奶意外重返少女时代，以雷霆手段肃清内鬼、守护千金家业。",
    social_info: { hot_text: "4120万热度", rating: "9.6", like_count: "93.5万" },
    episodes: buildEpisodes("20006", 102, "vertical"),
    celebrities: [
      { actor_id: "actor-101", name: "林清歌", role: "饰 容华", avatar: AVATARS[0] },
      { actor_id: "actor-104", name: "韩雨彤", role: "饰 容清欢", avatar: AVATARS[0] },
    ],
  },
  {
    series_id: "20007",
    series_title: "枝头春意闹",
    cover: POSTERS[1],
    episode_count: 79,
    total: 79,
    category: "real-drama",
    tags: ["真人剧", "古装", "千金"],
    description: "落魄尚书府千金巧设锦绣坊，与冷面镇北战神在江南烟雨中缔结良缘。",
    intro: "一纸退婚书后，沈氏千金独自撑起江南织造局，与微服私访的镇北侯并肩破获盐引大案。",
    social_info: { hot_text: "2450万热度", rating: "9.3", like_count: "44.8万" },
    episodes: buildEpisodes("20007", 79, "vertical"),
    celebrities: [
      { actor_id: "actor-101", name: "林清歌", role: "饰 沈知春", avatar: AVATARS[0] },
      { actor_id: "actor-107", name: "苏晚星", role: "饰 柳如眉", avatar: AVATARS[1] },
    ],
  },
  {
    series_id: "20008",
    series_title: "离婚后战神身份瞒不住了",
    cover: POSTERS[3],
    episode_count: 96,
    total: 96,
    category: "real-drama",
    tags: ["真人剧", "离婚", "战神"],
    description: "隐姓埋名三年遭冷眼提离婚，一朝龙令归位，满城权贵尽皆俯首。",
    intro: "北境战神萧北辰为报救命之恩入赘三年，签下离婚协议当日九霄神殿齐至迎归。",
    social_info: { hot_text: "2610万热度", rating: "9.0", like_count: "47.3万" },
    episodes: buildEpisodes("20008", 96, "vertical"),
    celebrities: [
      { actor_id: "actor-105", name: "时康", role: "饰 萧北辰", avatar: AVATARS[2] },
      { actor_id: "actor-107", name: "苏晚星", role: "饰 苏倾城", avatar: AVATARS[1] },
    ],
  },
  {
    series_id: "30001",
    series_title: "大荒纪元：苍穹横屏剧场",
    cover: POSTERS[0],
    episode_count: 45,
    total: 45,
    category: "ai-drama",
    tags: ["AI剧", "16:9横屏", "神医"],
    description: "16:9 宽银幕电影级画幅短剧，讲述上古药王谷传人横渡大荒苍穹的传奇。",
    intro: "支持 16:9 横屏等比自适应与全屏铺满切换的高清宽银幕剧集，展现大荒山海恢弘视效。",
    social_info: { hot_text: "2290万热度", rating: "9.4", like_count: "39.6万" },
    episodes: buildEpisodes("30001", 45, "horizontal"),
    celebrities: [
      { actor_id: "actor-107", name: "苏晚星", role: "饰 药灵儿", avatar: AVATARS[1] },
      { actor_id: "actor-108", name: "陈添祥", role: "饰 苍玄", avatar: AVATARS[2] },
    ],
  },
];

const importedSeries = signal<SeriesDetail[]>([]);
const seasonsCache = new Map<string, { items: SeasonEntry[]; expires: number }>();
const catalogPageCache = new Map<string, { data: PagedResult<SeriesSummary>; expires: number }>();
const actorPageCache = new Map<string, { data: PagedResult<ActorSummary> & { rankDate: string }; expires: number }>();
const seriesDetailCache = new Map<string, { detail: SeriesDetail; expires: number }>();
const seriesDetailInFlight = new Map<string, Promise<SeriesDetail>>();
const danmakuCache = new Map<string, DanmakuComment[]>();

const CATALOG_TTL_MS = 180_000;
const DETAIL_TTL_MS = 300_000;

function allSeriesPool(): SeriesDetail[] {
  return [...importedSeries(), ...FEATURED_SERIES, ...WANYAO_SEASONS.slice(1)];
}

const PAGE_SIZE = 10;

/** Queries catalog tab pages (`hot-drama`, `real-drama`, `comic-drama`, `ai-drama`) with SWR caching. */
export async function fetchCatalogPage(
  tab: CatalogTab,
  page = 1,
  options: { refresh?: boolean } = {},
): Promise<PagedResult<SeriesSummary>> {
  const cacheKey = `${tab}:${page}`;
  if (!options.refresh) {
    const hit = catalogPageCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) {
      return hit.data;
    }
  }

  let data: PagedResult<SeriesSummary>;
  if (externalAdapter) {
    const local = page === 1 ? importedSeries().filter(item => tab === "hot-drama" || item.category === tab) : [];
    try {
      const result = await externalAdapter.catalog(tab, page);
      data = { ...result, items: [...local, ...result.items.filter(item => !local.some(added => added.series_id === item.series_id))] };
    } catch (error) {
      if (!local.length) throw error;
      data = { items: local, page, hasMore: false, total: local.length };
    }
  } else {
    const pool = allSeriesPool();
    const filtered = pool.filter((item) => {
      if (tab === "hot-drama") return true;
      if (tab === "real-drama" || tab === "comic-drama" || tab === "ai-drama") {
        return item.category === tab;
      }
      return true;
    });

    const start = (Math.max(1, page) - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    data = {
      items: slice,
      page,
      hasMore: start + PAGE_SIZE < filtered.length,
      total: filtered.length,
    };
  }

  catalogPageCache.set(cacheKey, { data, expires: Date.now() + CATALOG_TTL_MS });
  return data;
}

function normalizeSearchText(input: string): string {
  return input.replace(/[\s:：,，.。!！?？·\-—_《》“”"']/g, "").toLowerCase();
}

/**
 * Searches dramas by keyword.
 * Generic base search `"万妖图录传"` omits Season 3 (`10003`) unless specifically queried
 * (`"万妖图录传第三季"` / `"万妖图录传第3季"`), exercising automatic missing-season gap backfill!
 */
export async function searchDramas(keyword: string, page = 1): Promise<PagedResult<SeriesSummary>> {
  if (externalAdapter) {
    const query = normalizeSearchText(keyword);
    const local = page === 1 ? importedSeries().filter(item => normalizeSearchText([item.series_title, item.description, ...item.tags].join(" ")).includes(query)) : [];
    try {
      const result = await externalAdapter.search(keyword, page);
      return { ...result, items: [...local, ...result.items.filter(item => !local.some(added => added.series_id === item.series_id))] };
    } catch (error) {
      if (!local.length) throw error;
      return { items: local, page, hasMore: false, total: local.length };
    }
  }

  const q = keyword.trim().toLowerCase();
  if (!q) return fetchCatalogPage("hot-drama", page);

  const normalizedQ = normalizeSearchText(q);
  const isTargetedSeason3 = normalizedQ.includes("第三季") || normalizedQ.includes("第3季");
  const pool = allSeriesPool().filter((item) => {
    if (item.series_id === "10003" && !isTargetedSeason3 && normalizedQ === "万妖图录传") {
      return false;
    }
    const rawHaystack = [
      item.series_title,
      item.description,
      ...item.tags,
      ...item.celebrities.map((c) => c.name),
    ]
      .join(" ")
      .toLowerCase();
    return rawHaystack.includes(q) || normalizeSearchText(rawHaystack).includes(normalizedQ);
  });

  const start = (Math.max(1, page) - 1) * PAGE_SIZE;
  const slice = pool.slice(start, start + PAGE_SIZE);
  return {
    items: slice,
    page,
    hasMore: start + PAGE_SIZE < pool.length,
    total: pool.length,
  };
}

/** Synchronous cache peek for instant 0ms Theater entry when already fetched or hovered. */
export function peekCachedSeriesDetail(seriesId: string): SeriesDetail | null {
  const imported = importedSeries().find((item) => item.series_id === seriesId);
  if (imported) return imported;
  const hit = seriesDetailCache.get(seriesId);
  if (hit && hit.expires > Date.now()) return hit.detail;
  if (!externalAdapter) {
    return allSeriesPool().find((s) => s.series_id === seriesId) ?? null;
  }
  return null;
}

/** Warms `SeriesDetail` in the background (e.g. when user hovers a `DramaCard` on desktop). */
export function prefetchSeriesDetail(seriesId: string): void {
  if (!seriesId || peekCachedSeriesDetail(seriesId) || seriesDetailInFlight.has(seriesId)) return;
  void fetchSeriesDetail(seriesId).catch(() => {});
}

/** Fetches complete series detail and episode list by `seriesId` with deduplication and TTL caching. */
export async function fetchSeriesDetail(seriesId: string, options: { refresh?: boolean } = {}): Promise<SeriesDetail> {
  const imported = importedSeries().find((item) => item.series_id === seriesId);
  if (imported) return imported;

  if (!options.refresh) {
    const hit = seriesDetailCache.get(seriesId);
    if (hit && hit.expires > Date.now()) return hit.detail;
    const inflight = seriesDetailInFlight.get(seriesId);
    if (inflight) return inflight;
  }

  const job = (async () => {
    if (externalAdapter) {
      const detail = await externalAdapter.getSeriesDetail(seriesId);
      seriesDetailCache.set(seriesId, { detail, expires: Date.now() + DETAIL_TTL_MS });
      return detail;
    }
    const found = allSeriesPool().find((s) => s.series_id === seriesId);
    if (!found) {
      throw new Error("未找到该剧集详情，请检查片源配置后重试。");
    }
    seriesDetailCache.set(seriesId, { detail: found, expires: Date.now() + DETAIL_TTL_MS });
    return found;
  })();

  seriesDetailInFlight.set(seriesId, job);
  try {
    return await job;
  } finally {
    if (seriesDetailInFlight.get(seriesId) === job) {
      seriesDetailInFlight.delete(seriesId);
    }
  }
}

/**
 * Resolves all related seasons for `series`, scanning pages with early-stop when no new matching
 * seasons appear, filling missing season gaps (`第N季`), and preserving prior entries on refresh.
 */
export async function resolveRelatedSeasons(
  series: SeriesSummary,
  options: { refresh?: boolean } = {},
): Promise<{ baseTitle: string; seasons: SeasonEntry[] }> {
  const { baseTitle } = parseSeasonInfo(series.series_title);
  const cacheKey = baseTitle.toLowerCase();
  const cache = seasonsCache.get(cacheKey);
  const cached = cache?.items ?? [];

  if (!options.refresh && cache && cache.expires > Date.now() && cached.length > 1) {
    return { baseTitle, seasons: cached };
  }

  let merged = aggregateRelatedSeasons(baseTitle, [series], cached);
  const seen = new Set<string>([series.series_id]);
  let unproductivePages = 0;

  // Scan up to 8 pages, stopping early once 2 consecutive pages yield zero new matching seasons for `baseTitle`.
  for (let page = 1; page <= 8; page++) {
    const res = await searchDramas(baseTitle, page);
    const fresh = res.items.filter((item) => !seen.has(item.series_id));
    for (const item of fresh) seen.add(item.series_id);
    if (fresh.length === 0) break;

    const prevCount = merged.length;
    merged = aggregateRelatedSeasons(baseTitle, fresh, merged);
    if (merged.length === prevCount) {
      unproductivePages++;
      if (unproductivePages >= 2) break;
    } else {
      unproductivePages = 0;
    }
    if (!res.hasMore) break;
  }

  const missingNums = findMissingSeasonNumbers(merged);
  for (const missingNum of missingNums) {
    for (const targetedQuery of toChineseSeasonQuery(baseTitle, missingNum)) {
      const targeted = await searchDramas(targetedQuery, 1);
      if (targeted.items.length > 0) {
        merged = aggregateRelatedSeasons(baseTitle, targeted.items, merged);
        if (merged.some((s) => s.seasonNum === missingNum)) break;
      }
    }
  }

  seasonsCache.set(cacheKey, { items: merged, expires: Date.now() + 180_000 });
  return { baseTitle, seasons: merged };
}

/** Fetches ranked actors filtered by gender (`all` | `male` | `female`) with SWR caching. */
export async function fetchActorRanking(
  gender: "all" | "male" | "female" = "all",
  page = 1,
  options: { refresh?: boolean } = {},
): Promise<PagedResult<ActorSummary> & { rankDate: string }> {
  const cacheKey = `${gender}:${page}`;
  if (!options.refresh) {
    const hit = actorPageCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.data;
  }

  let data: PagedResult<ActorSummary> & { rankDate: string };
  if (externalAdapter) {
    data = await externalAdapter.getActorRanking(gender, page);
  } else {
    const filtered = ACTORS.filter((a) => (gender === "all" ? true : a.gender === gender));
    const perPage = 8;
    const start = (Math.max(1, page) - 1) * perPage;
    data = {
      items: filtered.slice(start, start + perPage),
      page,
      hasMore: start + perPage < filtered.length,
      total: filtered.length,
      rankDate: "2026年11月16日",
    };
  }
  actorPageCache.set(cacheKey, { data, expires: Date.now() + CATALOG_TTL_MS });
  return data;
}

/** Fetches an actor's profile, co-stars, and paginated filmography. */
export async function fetchActorDetail(actorId: string): Promise<ActorDetail> {
  if (externalAdapter) return externalAdapter.getActorDetail(actorId);

  const base = ACTORS.find((a) => a.actor_id === actorId) ?? ACTORS[0];
  const works = allSeriesPool().filter((s) => s.celebrities.some((c) => c.actor_id === base.actor_id));
  const related = ACTORS.filter((a) => a.actor_id !== base.actor_id)
    .slice(0, 4)
    .map((a) => ({
      actor_id: a.actor_id,
      name: a.name,
      avatar: a.avatar,
      intro: a.sub_titles[0] ?? "",
    }));

  return {
    ...base,
    related_celebrities: related,
    works,
  };
}

/** Returns realistic multi-tier Danmaku comments with LRU caching & background prefetching. */
export async function fetchEpisodeDanmaku(
  vid: string,
  episodeIndex: number,
  seriesId?: string,
): Promise<DanmakuComment[]> {
  const key = `${seriesId || ""}:${vid}`;
  const cached = danmakuCache.get(key);
  if (cached) return cached;

  let items: DanmakuComment[];
  if (externalAdapter) {
    items = await externalAdapter.getEpisodeDanmaku(vid, episodeIndex, seriesId);
  } else {
    const templates = [
      { offset: 0.2, text: "原来你就是姜月初是你啊！", likes: 2 },
      { offset: 0.7, text: `回评：贼好看第 ${episodeIndex} 集老虎是伏笔`, likes: 8 },
      { offset: 1.2, text: "[鼓掌][鼓掌][鼓掌][鼓掌][鼓掌]", likes: 20 },
      { offset: 1.9, text: "有点像宁姚建模", likes: 44 },
      { offset: 2.5, text: "二刷二刷", likes: 19 },
      { offset: 3.1, text: "好看的，期待下季", likes: 28 },
      { offset: 3.9, text: "入股不亏！画质太顶了", likes: 168, featured: true },
      { offset: 4.8, text: "前方高能名场面预警", likes: 520, featured: true },
      { offset: 6.0, text: "打卡留念", likes: 0 },
      { offset: 7.2, text: "百妖谱展开这幕绝了", likes: 66 },
      { offset: 8.6, text: "直接连看十集停不下来", likes: 15 },
      { offset: 9.8, text: "下一集已经预载好啦无缝切！", likes: 132, featured: true },
    ];
    items = templates.map((item, idx) => ({
      id: `${vid}-dm-${idx}`,
      time_sec: item.offset,
      text: item.text,
      likes: item.likes,
      featured: item.featured,
    }));
  }

  if (danmakuCache.size >= 40) {
    const oldest = danmakuCache.keys().next().value;
    if (oldest) danmakuCache.delete(oldest);
  }
  danmakuCache.set(key, items);
  return items;
}

/** Preloads Danmaku for an upcoming episode so Danmaku starts at 0.0s with zero network wait. */
export function prefetchEpisodeDanmaku(vid: string, episodeIndex: number, seriesId?: string): void {
  const key = `${seriesId || ""}:${vid}`;
  if (danmakuCache.has(key)) return;
  void fetchEpisodeDanmaku(vid, episodeIndex, seriesId).catch(() => {});
}

/** Imports local standard video files (`.mp4`/`.mov`/`.webm`) or `.json` catalog manifests via native picker. */
export async function importLocalMediaFiles(): Promise<SeriesDetail | null> {
  const picked = await Picker.pickFiles({
    multiple: true,
    filters: [
      { name: "标准音视频与片单 (MP4/MOV/WebM/JSON)", extensions: ["mp4", "mov", "webm", "json"] },
    ],
  });
  if (picked.length === 0) return null;

  const jsonFiles = picked.filter((p) => p.file.name.toLowerCase().endsWith(".json"));
  for (const jf of jsonFiles) {
    const text = await jf.file.text();
    const added = ingestExternalCatalogJson(text);
    if (added.length > 0) return added[0];
  }

  const videoFiles = picked.filter((p) => /\.(mp4|mov|webm)$/i.test(p.file.name));
  if (videoFiles.length === 0) return null;

  const seriesId = `local-${Date.now()}`;
  const firstBase = videoFiles[0].file.name.replace(/\.[^.]+$/, "");
  const episodes: EpisodeItem[] = videoFiles.map((vf, idx) => ({
    vid: `${seriesId}-ep-${idx + 1}`,
    vid_index: idx + 1,
    title: vf.file.name.replace(/\.[^.]+$/, ""),
    duration_sec: 0,
    src: URL.createObjectURL(vf.file),
    aspect: "vertical",
    estimated_bytes: Math.max(1, vf.file.size),
  }));

  const created: SeriesDetail = {
    series_id: seriesId,
    series_title: videoFiles.length > 1 ? `${firstBase}（本地导入合集）` : firstBase,
    cover: POSTERS[0],
    episode_count: episodes.length,
    total: episodes.length,
    category: "real-drama",
    tags: ["本地导入", "标准媒体"],
    description: `本地导入的 ${episodes.length} 个标准媒体分集，支持连续播放与进度记忆。`,
    intro: `通过系统文件选择器导入的本地标准音视频合集（共 ${episodes.length} 集）。`,
    social_info: { hot_text: "本地媒体", rating: "9.9" },
    episodes,
    celebrities: [],
  };

  importedSeries.update((prev) => [created, ...prev]);
  seasonsCache.clear();
  catalogPageCache.clear();
  return created;
}

/** Loads and validates a standard external JSON media catalog from an HTTP(S) URL. */
export async function loadCustomCatalogFromUrl(url: string): Promise<SeriesDetail[]> {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error("请输入以 http:// 或 https:// 开头的 JSON 片单地址。");
  }
  const response = await fetch(clean);
  if (!response.ok) {
    throw new Error(`片单接口返回 HTTP ${response.status}，请检查地址后重试。`);
  }
  const raw = await response.text();
  const parsed = ingestExternalCatalogJson(raw);
  if (parsed.length === 0) {
    throw new Error("JSON 片单格式有效但未包含可播放的剧集条目。");
  }
  return parsed;
}

export function ingestExternalCatalogJson(rawJson: string): SeriesDetail[] {
  const data = JSON.parse(rawJson) as { series?: Partial<SeriesDetail>[] } | Partial<SeriesDetail>[];
  const list = Array.isArray(data) ? data : Array.isArray(data.series) ? data.series : [];
  const valid: SeriesDetail[] = [];

  list.forEach((entry, idx) => {
    if (!entry || typeof entry.series_title !== "string" || !Array.isArray(entry.episodes) || entry.episodes.length === 0) {
      return;
    }
    const sid = String(entry.series_id || `custom-${Date.now()}-${idx}`);
    const episodes: EpisodeItem[] = entry.episodes
      .filter((ep): ep is EpisodeItem => Boolean(ep && typeof ep.src === "string" && ep.src.trim()))
      .map((ep, i) => ({
        vid: String(ep.vid || `${sid}-ep-${i + 1}`),
        vid_index: Number(ep.vid_index) || i + 1,
        title: ep.title || `第 ${i + 1} 集`,
        duration_sec: Number(ep.duration_sec) || 0,
        src: ep.src,
        aspect: ep.aspect === "horizontal" ? "horizontal" : "vertical",
        estimated_bytes: Number(ep.estimated_bytes) || 900 * 1024,
      }));
    if (episodes.length === 0) return;

    valid.push({
      series_id: sid,
      series_title: entry.series_title,
      cover: entry.cover || POSTERS[idx % POSTERS.length],
      episode_count: episodes.length,
      total: episodes.length,
      category: entry.category ?? "real-drama",
      tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ["自定义片源"],
      description: entry.description || "自定义 JSON 接口接入剧集",
      intro: entry.intro || entry.description || "自定义 JSON 接口接入剧集",
      social_info: entry.social_info ?? { hot_text: "自定义源", rating: "9.5" },
      episodes,
      celebrities: Array.isArray(entry.celebrities) ? entry.celebrities : [],
    });
  });

  if (valid.length > 0) {
    importedSeries.update((prev) => {
      const nextIds = new Set(valid.map((v) => v.series_id));
      return [...valid, ...prev.filter((p) => !nextIds.has(p.series_id))];
    });
    seasonsCache.clear();
    catalogPageCache.clear();
  }
  return valid;
}
