import type { DramaSourceAdapter, PagedResult } from "./catalog";
import type { ActorDetail, ActorSummary, CatalogTab, DanmakuComment, DramaCategory, EpisodeItem, SeriesDetail, SeriesSummary } from "../domain/types";
import { backendRequest } from "./backend";

interface RawSeries {
  series_id: string; series_title?: string; cover?: string; episode_count?: number; total?: number;
  tags?: string[]; description?: string; intro?: string; social_info?: SeriesSummary["social_info"];
}
interface RawPage { results: RawSeries[]; page?: number; hasMore?: boolean; total?: number }

function summary(item: RawSeries, category: DramaCategory = "real-drama"): SeriesSummary {
  return { series_id: String(item.series_id), series_title: item.series_title || "", cover: item.cover || "",
    episode_count: item.episode_count || item.total || 0, category, tags: item.tags || [],
    description: item.description || item.intro || "", social_info: item.social_info };
}
function page(data: RawPage, requestedPage: number, category?: DramaCategory): PagedResult<SeriesSummary> {
  return { items: (data.results || []).map(item => summary(item, category)), page: data.page || requestedPage, hasMore: data.hasMore === true, total: data.total || 0 };
}
function actor(item: ActorSummary): ActorSummary {
  return { ...item, rank_change: { ...item.rank_change, type: item.rank_change?.type === 1 || item.rank_change?.type === 2 ? item.rank_change.type : 0 },
    gender: item.gender || "female", rank: item.rank || 0,
    sub_titles: item.sub_titles || [], intro: item.intro || "", score: item.score || "" };
}

export function createHongguoSource(): DramaSourceAdapter {
  const knownActors = new Map<string, ActorSummary>();
  return {
    async catalog(tab: CatalogTab, requestedPage: number) {
      const category = tab === "comic-drama" || tab === "ai-drama" ? tab : "real-drama";
      return page(await backendRequest<RawPage>(`/catalog?category=${encodeURIComponent(tab)}&page=${requestedPage}`), requestedPage, category);
    },
    async search(keyword: string, requestedPage: number) {
      return page(await backendRequest<RawPage>(`/search?keyword=${encodeURIComponent(keyword)}&page=${requestedPage}`), requestedPage);
    },
    async getSeriesDetail(id: string): Promise<SeriesDetail> {
      const data = await backendRequest<RawSeries & { episodes: { vid: string; vid_index: number; title?: string }[]; celebrities?: SeriesDetail["celebrities"] }>(`/series/${encodeURIComponent(id)}`);
      const episodes: EpisodeItem[] = data.episodes.map(item => ({ vid: String(item.vid), vid_index: item.vid_index,
        title: item.title || `第 ${item.vid_index} 集`, duration_sec: 0, src: "", aspect: "vertical", source: "hongguo", series_id: String(id) }));
      return { ...summary(data), total: data.total || episodes.length, intro: data.intro || "", episodes,
        celebrities: (data.celebrities || []).map(item => ({ ...item, role: item.role || "", avatar: item.avatar || "" })) };
    },
    async getActorRanking(gender, requestedPage) {
      const data = await backendRequest<{ actors: ActorSummary[]; page?: number; has_more?: boolean; rank_date?: string; total?: number }>(`/actors/ranking?gender=${gender}&page=${requestedPage}`);
      const items = (data.actors || []).map(actor);
      for (const item of items) knownActors.set(item.actor_id, item);
      return { items, page: data.page || requestedPage, hasMore: data.has_more === true, rankDate: data.rank_date || "", total: data.total || 0 };
    },
    async getActorDetail(id): Promise<ActorDetail> {
      const data = await backendRequest<{ actor: ActorSummary & { related_celebrities?: ActorDetail["related_celebrities"] }; works: RawSeries[] }>(`/actors/${encodeURIComponent(id)}`);
      return { ...actor({ ...knownActors.get(id), ...data.actor }), related_celebrities: data.actor.related_celebrities || [], works: (data.works || []).map(item => summary(item)) };
    },
    async getEpisodeDanmaku(vid, _index, seriesId): Promise<DanmakuComment[]> {
      if (!seriesId) return [];
      const data = await backendRequest<{ success: boolean; items: { time: number; text: string; likes: number }[] }>(`/danmaku/${encodeURIComponent(seriesId)}/${encodeURIComponent(vid)}`);
      if (!data.success) return [];
      return data.items.map((item, index) => ({ id: `${vid}-${index}`, time_sec: item.time, text: item.text, likes: item.likes, featured: item.likes >= 100 }));
    },
  };
}
