import { batch, setColorScheme, signal, Storage } from "nsh";
import type {
  AppearanceMode,
  FavoriteEntry,
  PlayerPreferences,
  SeriesSummary,
  WatchHistoryEntry,
} from "../domain/types";

const STORAGE_KEY = "open_player_user_data_v1";
const BACKUP_KEY = "open_player_user_data_v1_bak";

export const DEFAULT_PREFERENCES: PlayerPreferences = {
  danmakuEnabled: true,
  danmakuRows: 3,
  danmakuSpeed: "medium",
  danmakuOpacity: 0.85,
  danmakuLikesPriority: true,
  volume: 0.85,
  isMuted: false,
  playbackRate: "1.0",
  fitMode: "contain",
  appearance: "dark",
  customCatalogUrl: "",
};

interface PersistedData {
  history: Record<string, WatchHistoryEntry>;
  favorites: Record<string, FavoriteEntry>;
  searchHistory: string[];
  preferences: Partial<PlayerPreferences>;
}

const historyMap = signal<Record<string, WatchHistoryEntry>>({});
const favoritesMap = signal<Record<string, FavoriteEntry>>({});
const recentSearches = signal<string[]>([]);
const prefs = signal<PlayerPreferences>({ ...DEFAULT_PREFERENCES });
const storeHydrated = signal(false);

function sanitizePreferences(raw: unknown): PlayerPreferences {
  const out: PlayerPreferences = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.danmakuEnabled === "boolean") out.danmakuEnabled = r.danmakuEnabled;
  if (r.danmakuRows === 1 || r.danmakuRows === 3 || r.danmakuRows === 5) out.danmakuRows = r.danmakuRows;
  if (r.danmakuSpeed === "fast" || r.danmakuSpeed === "medium" || r.danmakuSpeed === "slow") {
    out.danmakuSpeed = r.danmakuSpeed;
  }
  if (typeof r.danmakuOpacity === "number" && Number.isFinite(r.danmakuOpacity)) {
    out.danmakuOpacity = Math.min(1, Math.max(0.1, r.danmakuOpacity));
  }
  if (typeof r.danmakuLikesPriority === "boolean") out.danmakuLikesPriority = r.danmakuLikesPriority;
  if (typeof r.volume === "number" && Number.isFinite(r.volume)) {
    out.volume = Math.min(1, Math.max(0, r.volume));
  }
  if (typeof r.isMuted === "boolean") out.isMuted = r.isMuted;
  if (
    r.playbackRate === "0.75" ||
    r.playbackRate === "1.0" ||
    r.playbackRate === "1.25" ||
    r.playbackRate === "1.5" ||
    r.playbackRate === "2.0"
  ) {
    out.playbackRate = r.playbackRate;
  }
  if (r.fitMode === "contain" || r.fitMode === "cover") out.fitMode = r.fitMode;
  if (r.appearance === "dark" || r.appearance === "light" || r.appearance === "system") {
    out.appearance = r.appearance;
  }
  if (typeof r.customCatalogUrl === "string") out.customCatalogUrl = r.customCatalogUrl.trim();
  return out;
}

function parsePersisted(text: string | null): PersistedData | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<PersistedData>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.history || typeof parsed.history !== "object" || Array.isArray(parsed.history)) return null;
    if (!parsed.favorites || typeof parsed.favorites !== "object" || Array.isArray(parsed.favorites)) return null;
    return {
      history: parsed.history,
      favorites: parsed.favorites,
      searchHistory: Array.isArray(parsed.searchHistory)
        ? parsed.searchHistory.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 10)
        : [],
      preferences: parsed.preferences ?? {},
    };
  } catch {
    return null;
  }
}

let writeChain: Promise<void> = Promise.resolve();

function persistSnapshot(): Promise<void> {
  const payload = JSON.stringify({
    history: historyMap(),
    favorites: favoritesMap(),
    searchHistory: recentSearches(),
    preferences: prefs(),
  } satisfies PersistedData);

  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      const previous = await Storage.getItem(STORAGE_KEY);
      if (previous) {
        await Storage.setItem(BACKUP_KEY, previous);
      }
      await Storage.setItem(STORAGE_KEY, payload);
    });
  return writeChain;
}

/** Loads persisted user state from `Storage` (falling back to `.bak` on corruption). */
export async function hydrateStore(): Promise<void> {
  const primary = parsePersisted(await Storage.getItem(STORAGE_KEY));
  const loaded = primary ?? parsePersisted(await Storage.getItem(BACKUP_KEY));
  if (loaded) {
    const cleanPrefs = sanitizePreferences(loaded.preferences);
    batch(() => {
      historyMap.set(loaded.history);
      favoritesMap.set(loaded.favorites);
      recentSearches.set(loaded.searchHistory);
      prefs.set(cleanPrefs);
      storeHydrated.set(true);
    });
    setColorScheme(cleanPrefs.appearance);
  } else {
    setColorScheme(DEFAULT_PREFERENCES.appearance);
    storeHydrated.set(true);
  }
}

export const isStoreHydrated = () => storeHydrated();
export const preferences = () => prefs();
export const searchHistoryList = () => recentSearches();

export function historyList(): WatchHistoryEntry[] {
  return Object.values(historyMap()).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export function getSeriesProgress(seriesId: string): WatchHistoryEntry | null {
  return historyMap()[seriesId] ?? null;
}

export function favoritesList(): FavoriteEntry[] {
  return Object.values(favoritesMap()).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export function isSeriesFavorited(seriesId: string): boolean {
  return Boolean(favoritesMap()[seriesId]);
}

export function updatePlayerPreferences(patch: Partial<PlayerPreferences>): Promise<void> {
  const next = sanitizePreferences({ ...prefs(), ...patch });
  prefs.set(next);
  if (patch.appearance) {
    setColorScheme(next.appearance);
  }
  return persistSnapshot();
}

export function cycleAppearance(): AppearanceMode {
  const current = prefs().appearance;
  const next: AppearanceMode = current === "dark" ? "light" : current === "light" ? "system" : "dark";
  void updatePlayerPreferences({ appearance: next });
  return next;
}

export function mutateSearchHistory(action: "add" | "remove" | "clear", keyword = ""): Promise<void> {
  const clean = keyword.trim();
  if (action === "clear") {
    recentSearches.set([]);
  } else if (action === "remove" && clean) {
    recentSearches.update((list) => list.filter((item) => item !== clean));
  } else if (action === "add" && clean) {
    recentSearches.update((list) => [clean, ...list.filter((item) => item !== clean)].slice(0, 10));
  }
  return persistSnapshot();
}

export function recordWatchProgress(entry: {
  series_id: string;
  series_title: string;
  cover: WatchHistoryEntry["cover"];
  episode_count: number;
  episode_index: number;
  vid: string;
  position_sec: number;
  duration_sec: number;
}): Promise<void> {
  const prev = historyMap()[entry.series_id];
  const watchedSet = new Set<number>(prev?.watched_indexes ?? []);
  watchedSet.add(entry.episode_index);

  const record: WatchHistoryEntry = {
    series_id: entry.series_id,
    series_title: entry.series_title,
    cover: entry.cover,
    episode_count: entry.episode_count,
    episode_index: Math.max(1, Math.floor(entry.episode_index)),
    vid: entry.vid,
    position_sec: Math.max(0, entry.position_sec),
    duration_sec: Math.max(0, entry.duration_sec),
    watched_indexes: [...watchedSet].sort((a, b) => a - b),
    updated_at: Date.now(),
  };

  historyMap.update((map) => ({ ...map, [entry.series_id]: record }));
  return persistSnapshot();
}

export function toggleFavoriteSeries(series: SeriesSummary): { favorited: boolean; saved: Promise<void> } {
  let favorited = false;
  favoritesMap.update((map) => {
    const next = { ...map };
    if (next[series.series_id]) {
      delete next[series.series_id];
      favorited = false;
    } else {
      next[series.series_id] = {
        series_id: series.series_id,
        series_title: series.series_title,
        cover: series.cover,
        episode_count: series.episode_count,
        tags: series.tags,
        description: series.description,
        updated_at: Date.now(),
      };
      favorited = true;
    }
    return next;
  });
  return { favorited, saved: persistSnapshot() };
}

export function clearWatchHistory(): Promise<void> {
  historyMap.set({});
  return persistSnapshot();
}

export function removeHistorySeries(seriesId: string): Promise<void> {
  historyMap.update((map) => {
    if (!map[seriesId]) return map;
    const next = { ...map };
    delete next[seriesId];
    return next;
  });
  return persistSnapshot();
}
