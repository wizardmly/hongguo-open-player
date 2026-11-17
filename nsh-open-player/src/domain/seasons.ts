import type { SeasonEntry, SeriesSummary } from "./types";

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Parses Chinese or Arabic numerals (1..99) used in season titles. */
export function parseChineseOrArabicNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d{1,2}$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 1 && n <= 99 ? n : null;
  }
  if (trimmed === "十") return 10;
  if (trimmed.startsWith("十") && trimmed.length === 2) {
    const ones = CN_DIGITS[trimmed[1]];
    return ones !== undefined ? 10 + ones : null;
  }
  if (trimmed.endsWith("十") && trimmed.length === 2) {
    const tens = CN_DIGITS[trimmed[0]];
    return tens !== undefined ? tens * 10 : null;
  }
  if (trimmed.length === 3 && trimmed[1] === "十") {
    const tens = CN_DIGITS[trimmed[0]];
    const ones = CN_DIGITS[trimmed[2]];
    return tens !== undefined && ones !== undefined ? tens * 10 + ones : null;
  }
  if (trimmed.length === 1 && CN_DIGITS[trimmed] !== undefined) {
    return CN_DIGITS[trimmed] > 0 ? CN_DIGITS[trimmed] : null;
  }
  return null;
}

const NUM_TO_CN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

export function toChineseSeasonQuery(baseTitle: string, seasonNum: number): string[] {
  const cn = NUM_TO_CN[seasonNum];
  const queries = [`${baseTitle}第${seasonNum}季`];
  if (cn) {
    queries.unshift(`${baseTitle}第${cn}季`);
  }
  return queries;
}

export interface ParsedSeasonTitle {
  baseTitle: string;
  seasonNum: number;
  seasonLabel: string;
}

/** Extracts normalized base title and 1-based season index from a drama title. */
export function parseSeasonInfo(title: string): ParsedSeasonTitle {
  const clean = title.trim();
  const sepPattern = /^(.*?)[\s:：·\-—_]*(?:第\s*([零一二两三四五六七八九十\d]{1,3})\s*[季部篇]|Season\s*(\d{1,2})|S(\d{1,2}))\s*$/i;
  const match = clean.match(sepPattern);
  if (match) {
    const base = match[1].trim();
    const rawNum = match[2] ?? match[3] ?? match[4] ?? "";
    const num = parseChineseOrArabicNumber(rawNum);
    if (base && num !== null) {
      return {
        baseTitle: base,
        seasonNum: num,
        seasonLabel: `第${num}季`,
      };
    }
  }
  return {
    baseTitle: clean,
    seasonNum: 1,
    seasonLabel: "第1季",
  };
}

function normalizeBaseKey(title: string): string {
  return title.replace(/[\s:：,，.。!！?？·\-—_]/g, "").toLowerCase();
}

/** Filters candidates belonging to `targetBaseTitle`, deduplicates, and sorts strictly ascending. */
export function aggregateRelatedSeasons(
  targetBaseTitle: string,
  candidates: SeriesSummary[],
  existing: SeasonEntry[] = [],
): SeasonEntry[] {
  const targetKey = normalizeBaseKey(targetBaseTitle);
  if (!targetKey) return [];

  const bySeason = new Map<number, SeasonEntry>();

  const ingest = (item: SeriesSummary) => {
    const parsed = parseSeasonInfo(item.series_title);
    if (normalizeBaseKey(parsed.baseTitle) !== targetKey) return;
    const entry: SeasonEntry = {
      ...item,
      baseTitle: targetBaseTitle,
      seasonNum: parsed.seasonNum,
      seasonLabel: parsed.seasonLabel,
      total: item.episode_count,
    };
    const prior = bySeason.get(entry.seasonNum);
    if (!prior || entry.episode_count >= prior.episode_count) {
      bySeason.set(entry.seasonNum, entry);
    }
  };

  for (const prev of existing) ingest(prev);
  for (const cand of candidates) ingest(cand);

  return [...bySeason.values()].sort((a, b) => a.seasonNum - b.seasonNum);
}

/** Returns missing season numbers inside `1..maxSeason` (e.g. `[1, 2, 4]` -> `[3]`). */
export function findMissingSeasonNumbers(seasons: SeasonEntry[]): number[] {
  if (seasons.length === 0) return [];
  const present = new Set(seasons.map((s) => s.seasonNum));
  const maxSeason = Math.max(...present);
  if (maxSeason <= 1 || maxSeason > 24) return [];
  const missing: number[] = [];
  for (let n = 1; n <= maxSeason; n++) {
    if (!present.has(n)) missing.push(n);
  }
  return missing;
}
