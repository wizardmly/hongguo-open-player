import type { ImageAsset } from "nsh";

export type CatalogTab =
  | "hot-drama"
  | "actors"
  | "real-drama"
  | "comic-drama"
  | "ai-drama"
  | "history"
  | "favorites"
  | "search";

export type DramaCategory = "real-drama" | "comic-drama" | "ai-drama";

export interface CastMember {
  actor_id: string;
  name: string;
  role: string;
  avatar: ImageAsset | string;
}

export interface SocialInfo {
  hot_text: string;
  rating: string;
  like_count?: string;
}

export interface EpisodeItem {
  source?: "hongguo";
  series_id?: string;
  vid: string;
  vid_index: number;
  title: string;
  duration_sec: number;
  src: string;
  aspect: "vertical" | "horizontal";
  estimated_bytes?: number;
}

export interface SeriesSummary {
  series_id: string;
  series_title: string;
  cover: ImageAsset | string;
  episode_count: number;
  category: DramaCategory;
  tags: string[];
  description: string;
  social_info?: SocialInfo;
  watched_index?: number;
  rec_text?: string;
}

export interface SeriesDetail extends SeriesSummary {
  total: number;
  intro: string;
  episodes: EpisodeItem[];
  celebrities: CastMember[];
}

export interface SeasonEntry extends SeriesSummary {
  baseTitle: string;
  seasonNum: number;
  seasonLabel: string;
  total: number;
}

export interface RankChange {
  /** 1 = up, 2 = down, 0 = steady */
  type: 0 | 1 | 2;
  num?: number;
}

export interface ActorSummary {
  actor_id: string;
  name: string;
  gender: "male" | "female";
  rank: number;
  rank_change: RankChange;
  avatar: ImageAsset | string;
  score: string;
  sub_titles: string[];
  intro: string;
}

export interface ActorDetail extends ActorSummary {
  related_celebrities: {
    actor_id: string;
    name: string;
    avatar: ImageAsset | string;
    intro: string;
  }[];
  works: SeriesSummary[];
}

export interface DanmakuComment {
  id: string;
  time_sec: number;
  text: string;
  likes: number;
  featured?: boolean;
}

export interface WatchHistoryEntry {
  series_id: string;
  series_title: string;
  cover: ImageAsset | string;
  episode_count: number;
  episode_index: number;
  vid: string;
  position_sec: number;
  duration_sec: number;
  watched_indexes: number[];
  updated_at: number;
}

export interface FavoriteEntry {
  series_id: string;
  series_title: string;
  cover: ImageAsset | string;
  episode_count: number;
  tags: string[];
  description: string;
  updated_at: number;
}

export type DanmakuSpeed = "fast" | "medium" | "slow";
export type FitMode = "contain" | "cover";
export type PlaybackRateStr = "0.75" | "1.0" | "1.25" | "1.5" | "2.0";
export type AppearanceMode = "dark" | "light" | "system";

export interface PlayerPreferences {
  danmakuEnabled: boolean;
  danmakuRows: 1 | 3 | 5;
  danmakuSpeed: DanmakuSpeed;
  danmakuOpacity: number;
  danmakuLikesPriority: boolean;
  volume: number;
  isMuted: boolean;
  playbackRate: PlaybackRateStr;
  fitMode: FitMode;
  appearance: AppearanceMode;
  customCatalogUrl: string;
}

export type PreloadStatus = "idle" | "queued" | "loading" | "ready" | "error";
