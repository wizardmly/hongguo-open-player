import { platform } from "nsh";
import { describe, expect, open, test } from "nsh/test";
import {
  aggregateRelatedSeasons,
  findMissingSeasonNumbers,
  parseSeasonInfo,
} from "./src/domain/seasons";
import type { EpisodeItem, SeriesSummary } from "./src/domain/types";
import { EpisodePreloadManager } from "./src/services/preloader";

const TEST_VIEWPORT =
  platform.idiom === "terminal" ? { width: 140, height: 48 } : { width: 1280, height: 840 };

function makeEp(index: number, bytes = 40 * 1024 * 1024): EpisodeItem {
  return {
    vid: `ep-${index}`,
    vid_index: index,
    title: `第 ${index} 集`,
    duration_sec: 12,
    src: `asset:/ep-${index}.mp4`,
    aspect: "vertical",
    estimated_bytes: bytes,
  };
}

describe("domain: multi-season parsing and missing-season backfill", () => {
  test("parses Chinese and Arabic season titles and detects missing gaps", () => {
    expect(parseSeasonInfo("万妖图录传")).toEqual({
      baseTitle: "万妖图录传",
      seasonNum: 1,
      seasonLabel: "第1季",
    });
    expect(parseSeasonInfo("万妖图录传第三季")).toEqual({
      baseTitle: "万妖图录传",
      seasonNum: 3,
      seasonLabel: "第3季",
    });
    expect(parseSeasonInfo("万妖图录传 第12季")).toEqual({
      baseTitle: "万妖图录传",
      seasonNum: 12,
      seasonLabel: "第12季",
    });

    const partial: SeriesSummary[] = [1, 2, 4, 5].map((n) => ({
      series_id: `s-${n}`,
      series_title: n === 1 ? "万妖图录传第一季" : `万妖图录传第${n}季`,
      cover: "",
      episode_count: 80,
      category: "comic-drama",
      tags: [],
      description: "",
    }));

    const aggregated = aggregateRelatedSeasons("万妖图录传", partial);
    expect(aggregated.map((s) => s.seasonNum)).toEqual([1, 2, 4, 5]);
    expect(findMissingSeasonNumbers(aggregated)).toEqual([3]);
  });
});

describe("service: sequential 3-episode preloader and 128MB LRU cache", () => {
  test("cancels obsolete playback before starting the selected episode", async () => {
    const order: string[] = [];
    let oldSignal: AbortSignal | undefined;
    const manager = new EpisodePreloadManager({
      loader: async (ep, signal) => {
        order.push(ep.vid);
        if (ep.vid_index === 1) {
          oldSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        return { resolvedUrl: ep.src, sizeBytes: 1024 };
      },
    });
    const oldPlayback = manager.acquireForPlayback(makeEp(1)).catch(() => null);
    const selected = await manager.acquireForPlayback(makeEp(6));
    await oldPlayback;
    expect(oldSignal?.aborted).toBe(true);
    expect(selected.vid).toBe("ep-6");
    expect(order).toEqual(["ep-1", "ep-6"]);
    expect(manager.getStatus("ep-1")).toBe("idle");
  });

  test("preloads upcoming 3 episodes sequentially and reuses in-flight job on switch", async () => {
    const startedOrder: string[] = [];
    const resolvers = new Map<string, () => void>();

    const manager = new EpisodePreloadManager({
      prefetchAheadCount: 3,
      loader: async (ep) => {
        startedOrder.push(ep.vid);
        await new Promise<void>((resolve) => {
          resolvers.set(ep.vid, resolve);
        });
        return { resolvedUrl: ep.src, sizeBytes: 1024 };
      },
    });

    const episodes = [1, 2, 3, 4, 5, 6].map((i) => makeEp(i, 1024));

    const play1 = manager.acquireForPlayback(episodes[0]);
    expect(startedOrder).toEqual(["ep-1"]);
    resolvers.get("ep-1")!();
    await play1;

    const scheduled = manager.scheduleUpcoming(episodes, 1);
    expect(scheduled.map((e) => e.vid)).toEqual(["ep-2", "ep-3", "ep-4"]);
    expect(startedOrder).toEqual(["ep-1", "ep-2"]);

    const switchTo2 = manager.acquireForPlayback(episodes[1]);
    expect(startedOrder).toEqual(["ep-1", "ep-2"]);
    resolvers.get("ep-2")!();
    await switchTo2;

    expect(startedOrder).toEqual(["ep-1", "ep-2", "ep-3"]);
    resolvers.get("ep-3")!();
    await new Promise((r) => setTimeout(r, 5));
    expect(startedOrder).toEqual(["ep-1", "ep-2", "ep-3", "ep-4"]);
    resolvers.get("ep-4")!();
    await new Promise((r) => setTimeout(r, 5));

    expect(manager.cachedVids()).toEqual(["ep-1", "ep-2", "ep-3", "ep-4"]);
  });

  test("prioritizes active playback ahead of queued prefetches and enforces 128MB cache cap", async () => {
    const order: string[] = [];
    const gates = new Map<string, () => void>();

    const manager = new EpisodePreloadManager({
      prefetchAheadCount: 3,
      maxCacheBytes: 128 * 1024 * 1024,
      loader: async (ep) => {
        order.push(ep.vid);
        await new Promise<void>((resolve) => {
          gates.set(ep.vid, resolve);
        });
        return { resolvedUrl: ep.src, sizeBytes: ep.estimated_bytes ?? 1024 };
      },
    });

    const episodes = [1, 2, 3, 4, 5, 6].map((i) => makeEp(i, 40 * 1024 * 1024));

    manager.scheduleUpcoming(episodes, 1);
    expect(order).toEqual(["ep-2"]);

    const jump6 = manager.acquireForPlayback(episodes[5]);
    gates.get("ep-2")!();
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["ep-2", "ep-6"]);

    gates.get("ep-6")!();
    await jump6;
    await new Promise((r) => setTimeout(r, 5));
    gates.get("ep-3")!();
    await new Promise((r) => setTimeout(r, 5));
    gates.get("ep-4")!();
    await new Promise((r) => setTimeout(r, 5));

    expect(manager.totalCachedBytes()).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(manager.isCached("ep-6")).toBe(true);
  });
});

describe("ui: catalog, search, actor ranking, multi-season backfill and theater playback", () => {
  test("browses categories, searches with history, and connects a custom JSON source", async () => {
    const customCatalog = {
      series: [
        {
          series_id: "90001",
          series_title: "测试接入剧场",
          episode_count: 3,
          category: "real-drama",
          tags: ["自定义JSON", "标准MP4"],
          description: "通过 JSON 接口动态接入的短剧",
          episodes: [
            { vid: "90001-1", vid_index: 1, title: "第 1 集", src: "asset:/custom-1.mp4" },
            { vid: "90001-2", vid_index: 2, title: "第 2 集", src: "asset:/custom-2.mp4" },
          ],
        },
      ],
    };

    const app = await open("./App.tsx", {
      ...TEST_VIEWPORT,
      network: {
        "GET https://media.example.com/open-catalog.json": {
          status: 200,
          body: customCatalog,
        },
      },
    });

    await app.waitFor("万妖图录传第一季");
    expect(app.shows("和离后我带女儿横扫魔域第二季")).toBe(true);
    expect(app.shows("装穷提亲，娶到全家嫌弃的她")).toBe(true);

    // Filter by category tab
    await app.press("id:nav-tab-real-drama");
    await app.waitFor("别欺负小福宝，她能洞悉万物");
    expect(app.shows("十八岁太奶驾到，重整家族荣耀")).toBe(true);

    // Search and verify recent search history
    await app.type("id:search-input", "重生");
    await app.waitFor("id:search-submit-btn");
    await app.press("id:search-submit-btn");
    await app.waitFor("谁让这个文盲修仙的第六季");

    // Connect custom JSON catalog via menu -> SourceConfigModal
    await app.press("id:app-menu-trigger");
    await app.waitFor("id:menu-config-source");
    await app.press("id:menu-config-source");
    await app.waitFor("id:custom-source-url-input");
    await app.type("id:custom-source-url-input", "https://media.example.com/open-catalog.json");
    await app.press("id:apply-source-url-btn");
    await app.waitFor("测试接入剧场");
  });

  test("opens actor leaderboard, filters actors, and starts playback from actor filmography", async () => {
    const app = await open("./App.tsx", TEST_VIEWPORT);

    await app.waitFor("id:nav-tab-actors");
    await app.press("id:nav-tab-actors");
    await app.waitFor("红果短剧 · 剧星榜");
    expect(app.shows("林清歌")).toBe(true);
    expect(app.shows("陆行舟")).toBe(true);

    await app.press("id:actor-filter-female");
    await app.waitFor("韩雨彤");
    expect(app.shows("陆行舟")).toBe(false);

    await app.press("id:actor-card-actor-101");
    await app.waitFor("🎬 参演短剧作品 (11)");
    await app.press("id:drama-card-10001");
    await app.waitFor("id:exit-theater-btn");
    expect(app.shows("第 1 集 / 全 81 集")).toBe(true);
  });

  test("plays drama, preloads next 3 episodes, backfills missing Season 3 (186 eps), copies title and persists history/favorites", async () => {
    const app = await open("./App.tsx", TEST_VIEWPORT);

    await app.waitFor("id:drama-card-10001");
    await app.press("id:drama-card-10001");
    await app.waitFor("第 1 集 / 全 81 集");

    // Verify background sequential preload completes for upcoming 3 episodes (ep 2, 3, 4)!
    await app.waitFor("预载 3/3 集");

    // Keyboard shortcut Down -> switches immediately to preloaded Episode 2!
    await app.keyboard.press("down");
    await app.waitFor("第 2 集 / 全 81 集");

    // Switch episode group tab 31-60 and pick episode 32
    await app.press("id:ep-group-31-60");
    await app.waitFor("id:ep-btn-32");
    await app.press("id:ep-btn-32");
    await app.waitFor("第 32 集 / 全 81 集");

    // Toggle favorite
    await app.press("id:theater-fav-btn");
    await app.waitFor("❤️ 已收藏");

    // Open Drama Detail Modal & copy title to clipboard
    await app.press("id:open-drama-detail-card");
    await app.waitFor("id:copy-drama-title-btn");
    await app.press("id:copy-drama-title-btn");
    await app.waitUntil(() => app.clipboard() === "万妖图录传第一季");
    await app.press("继续播放");

    // Open All-Seasons Modal -> verify Season 3 (186 episodes) was automatically backfilled among all 9 seasons!
    await app.waitFor("id:open-seasons-modal-btn");
    await app.press("id:open-seasons-modal-btn");
    await app.waitFor("共 9 季 · 已排好序");
    expect(app.shows("共 186 集")).toBe(true);

    // Click Season 3 and verify seamless switch to 《万妖图录传第三季》 (186 episodes)!
    await app.press("id:modal-season-3");
    await app.waitFor("第 1 集 / 全 186 集");
    expect(app.texts()).toContain("万妖图录传第三季");

    // Exit theater and verify Watch History & Favorites tabs
    await app.press("id:exit-theater-btn");
    await app.waitFor("id:nav-tab-history");
    await app.press("id:nav-tab-history");
    await app.waitFor("已看至第 32 集");

    await app.press("id:nav-tab-favorites");
    await app.waitFor("万妖图录传第一季");
    expect(Object.keys(app.storage()).length).toBeGreaterThan(0);
  });
});
