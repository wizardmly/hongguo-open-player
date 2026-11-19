import { batch, type InputRef, keymap, mount, platform, signal, View } from "nsh";
import { Application, currentWindow, isAvailable as desktopWindowAvailable } from "nsh/desktop";
import { AppHeader } from "./src/components/AppHeader";
import {
  AboutModal,
  ActorModal,
  DramaDetailModal,
  SeasonsModal,
  ShortcutsModal,
  SourceConfigModal,
} from "./src/components/Modals";
import { parseSeasonInfo } from "./src/domain/seasons";
import type {
  ActorDetail,
  ActorSummary,
  CatalogTab,
  SeasonEntry,
  SeriesDetail,
  SeriesSummary,
  WatchHistoryEntry,
} from "./src/domain/types";
import { ActorRankingView } from "./src/pages/ActorRankingView";
import { CatalogView } from "./src/pages/CatalogView";
import { TheaterView } from "./src/pages/TheaterView";
import {
  fetchActorDetail,
  fetchActorRanking,
  fetchCatalogPage,
  fetchSeriesDetail,
  importLocalMediaFiles,
  loadCustomCatalogFromUrl,
  peekCachedSeriesDetail,
  prefetchSeriesDetail,
  registerSourceAdapter,
  resolveRelatedSeasons,
  searchDramas,
} from "./src/services/catalog";
import { createHongguoSource } from "./src/services/hongguo-source";
import {
  clearWatchHistory,
  cycleAppearance,
  favoritesList,
  getSeriesProgress,
  historyList,
  hydrateStore,
  isSeriesFavorited,
  mutateSearchHistory,
  preferences,
  removeHistorySeries,
  searchHistoryList,
  toggleFavoriteSeries,
  updatePlayerPreferences,
} from "./src/services/store";
import { showToast, UiToastHost } from "./src/ui";
import { UiGalleryModal } from "./src/ui/gallery";
import { shutdownHongguoEngine } from "./src/hongguo/media-engine";

function App() {
  const win = desktopWindowAvailable ? currentWindow() : null;
  win?.set({ titleBar: { style: "hidden", height: 40 } });
  let searchInputRef: InputRef | undefined;

  const viewMode = signal<"catalog" | "theater">("catalog");
  const currentTab = signal<CatalogTab>("hot-drama");
  const searchDraft = signal("");
  const activeSearchQuery = signal("");

  // Catalog state
  const catalogItems = signal<SeriesSummary[]>([]);
  const catalogPage = signal(1);
  const catalogHasMore = signal(false);
  const catalogLoading = signal(true);
  const catalogError = signal<string | null>(null);

  // Actor ranking state
  const actors = signal<ActorSummary[]>([]);
  const actorGender = signal<"all" | "male" | "female">("all");
  const actorRankDate = signal("");
  const actorPage = signal(1);
  const actorHasMore = signal(false);
  const loadingActors = signal(false);

  // Active Theater state
  const activeSeries = signal<SeriesDetail | null>(null);
  const loadingSeriesDetail = signal(false);
  const theaterInitialEp = signal(1);
  const theaterInitialSec = signal(0);
  const relatedSeasons = signal<SeasonEntry[]>([]);
  const seriesBaseTitle = signal("");
  const checkingSeasons = signal(false);

  // Modals state
  const activeActorDetail = signal<ActorDetail | null>(null);
  const actorModalOpen = signal(false);
  const loadingActorModal = signal(false);
  const dramaDetailOpen = signal(false);
  const seasonsModalOpen = signal(false);
  const sourceModalOpen = signal(false);
  const shortcutsModalOpen = signal(false);
  const galleryModalOpen = signal(false);
  const aboutModalOpen = signal(false);

  let catalogLoadSeq = 0;
  let actorLoadSeq = 0;
  let seasonsLoadSeq = 0;
  let openTheaterSeq = 0;

  const isFullScreenTheater = () =>
    viewMode() === "theater" && win?.state()?.mode === "fullScreen";

  const hasAnyModalOpen = () =>
    actorModalOpen() ||
    dramaDetailOpen() ||
    seasonsModalOpen() ||
    sourceModalOpen() ||
    shortcutsModalOpen() ||
    galleryModalOpen() ||
    aboutModalOpen();

  const loadCatalog = async (
    tab = currentTab(),
    page = catalogPage(),
    query = activeSearchQuery(),
    options: { refresh?: boolean } = {},
  ) => {
    if (tab === "history" || tab === "favorites" || tab === "actors") {
      catalogLoading.set(false);
      catalogError.set(null);
      return;
    }
    const seq = ++catalogLoadSeq;
    // Only show full-page skeletons if we don't already have items on the initial page or if explicitly changing pages/queries
    if (catalogItems().length === 0 || options.refresh) {
      catalogLoading.set(true);
    }
    catalogError.set(null);
    try {
      const res =
        tab === "search"
          ? await searchDramas(query, page)
          : await fetchCatalogPage(tab, page, options);
      if (seq !== catalogLoadSeq) return;
      batch(() => {
        catalogItems.set(res.items);
        catalogPage.set(res.page);
        catalogHasMore.set(res.hasMore);
        catalogLoading.set(false);
      });
      // Warm detail of top #1 drama & next catalog page for instant first click!
      if (res.items.length > 0 && page === 1) {
        if (tab === "search") {
          prefetchSeriesDetail(res.items[0].series_id);
        } else {
          setTimeout(() => {
            if (res.items[0]) prefetchSeriesDetail(res.items[0].series_id);
          }, 200);
        }
      }
      if (res.hasMore && tab !== "search") {
        setTimeout(() => {
          void fetchCatalogPage(tab, page + 1).catch(() => {});
        }, 500);
      }
    } catch (err) {
      if (seq !== catalogLoadSeq) return;
      catalogLoading.set(false);
      catalogError.set(err instanceof Error ? err.message : String(err));
    }
  };

  const loadActors = async (
    gender = actorGender(),
    page = actorPage(),
    options: { refresh?: boolean } = {},
  ) => {
    const seq = ++actorLoadSeq;
    if (actors().length === 0 || options.refresh) {
      loadingActors.set(true);
    }
    try {
      const res = await fetchActorRanking(gender, page, options);
      if (seq !== actorLoadSeq) return;
      batch(() => {
        actors.set(res.items);
        actorRankDate.set(res.rankDate);
        actorPage.set(res.page);
        actorHasMore.set(res.hasMore);
        loadingActors.set(false);
      });
    } catch {
      if (seq !== actorLoadSeq) return;
      loadingActors.set(false);
    }
  };

  const loadSeasonsForSeries = async (series: SeriesSummary, refresh = false) => {
    const seq = ++seasonsLoadSeq;
    checkingSeasons.set(true);
    try {
      const resolved = await resolveRelatedSeasons(series, { refresh });
      if (seq !== seasonsLoadSeq) return;
      batch(() => {
        seriesBaseTitle.set(resolved.baseTitle);
        relatedSeasons.set(resolved.seasons);
        checkingSeasons.set(false);
      });
    } catch {
      if (seq !== seasonsLoadSeq) return;
      checkingSeasons.set(false);
    }
  };

  void hydrateStore().then(() => {
    const latest = historyList()[0];
    if (latest) {
      setTimeout(() => prefetchSeriesDetail(latest.series_id), 150);
    }
    const customUrl = preferences().customCatalogUrl;
    if (customUrl) {
      void loadCustomCatalogFromUrl(customUrl)
        .catch(() => {})
        .finally(() => void loadCatalog("hot-drama", 1, ""));
    } else {
      void loadCatalog("hot-drama", 1, "");
    }
  });

  keymap.bind("mod+k", () => {
    searchInputRef?.focus();
  });
  keymap.bind(
    "shift+/",
    () => {
      shortcutsModalOpen.set(true);
    },
    { when: "notEditing" },
  );

  const displayedCatalogDramas = (): SeriesSummary[] => {
    const tab = currentTab();
    if (tab === "history") {
      return historyList().map((h) => ({
        series_id: h.series_id,
        series_title: h.series_title,
        cover: h.cover,
        episode_count: h.episode_count,
        category: "real-drama",
        tags: [`上次看至第 ${h.episode_index} 集`],
        description: `观看进度：第 ${h.episode_index} 集`,
        watched_index: h.episode_index,
      }));
    }
    if (tab === "favorites") {
      return favoritesList().map((f) => ({
        series_id: f.series_id,
        series_title: f.series_title,
        cover: f.cover,
        episode_count: f.episode_count,
        category: "real-drama",
        tags: f.tags,
        description: f.description,
      }));
    }
    return catalogItems();
  };

  const exitTheaterToCatalog = () => {
    openTheaterSeq++;
    loadingSeriesDetail.set(false);
    if (win?.state()?.mode === "fullScreen") {
      win.setMode("normal");
    }
    viewMode.set("catalog");
  };

  const switchTab = (tab: CatalogTab) => {
    openTheaterSeq++;
    loadingSeriesDetail.set(false);
    if (win?.state()?.mode === "fullScreen") {
      win.setMode("normal");
    }
    batch(() => {
      viewMode.set("catalog");
      currentTab.set(tab);
      catalogPage.set(1);
    });
    if (tab === "actors") {
      void loadActors(actorGender(), 1);
    } else {
      void loadCatalog(tab, 1, activeSearchQuery());
    }
  };

  const runSearch = (rawKeyword: string) => {
    const kw = rawKeyword.trim();
    if (!kw) {
      switchTab("hot-drama");
      return;
    }
    openTheaterSeq++;
    loadingSeriesDetail.set(false);
    void mutateSearchHistory("add", kw);
    batch(() => {
      searchDraft.set(kw);
      activeSearchQuery.set(kw);
      viewMode.set("catalog");
      catalogItems.set([]);
      currentTab.set("search");
      catalogPage.set(1);
    });
    void loadCatalog("search", 1, kw, { refresh: true });
  };

  /**
   * Optimistic Instant Theater Entry:
   * Enters Theater in <16ms using cached detail (0ms if hovered/visited!) or an optimistic shell
   * while `fetchSeriesDetail` completes in parallel with `resolveRelatedSeasons`.
   */
  const openTheater = async (summary: SeriesSummary, overrideEp?: number, overrideSec?: number) => {
    const seq = ++openTheaterSeq;
    const saved = getSeriesProgress(summary.series_id);
    const targetEp = overrideEp ?? saved?.episode_index ?? 1;
    const targetSec = overrideSec ?? (overrideEp ? 0 : (saved?.position_sec ?? 0));

    const { baseTitle } = parseSeasonInfo(summary.series_title);
    const sameSeriesFamily = seriesBaseTitle() && seriesBaseTitle() === baseTitle;

    const cachedDetail = peekCachedSeriesDetail(summary.series_id);
    if (cachedDetail) {
      batch(() => {
        activeSeries.set(cachedDetail);
        loadingSeriesDetail.set(false);
        theaterInitialEp.set(targetEp);
        theaterInitialSec.set(targetSec);
        if (!sameSeriesFamily) {
          relatedSeasons.set([]);
          seriesBaseTitle.set(baseTitle);
        }
        viewMode.set("theater");
        actorModalOpen.set(false);
        seasonsModalOpen.set(false);
        dramaDetailOpen.set(false);
      });
      void loadSeasonsForSeries(cachedDetail, false);
      return;
    }

    // Optimistic shell for instant transition (<16ms) before live HTTP `/series/:id` finishes!
    const optimisticShell: SeriesDetail = {
      ...summary,
      total: summary.episode_count || 0,
      intro: summary.description || "",
      episodes: [],
      celebrities: [],
    };

    batch(() => {
      activeSeries.set(optimisticShell);
      loadingSeriesDetail.set(true);
      theaterInitialEp.set(targetEp);
      theaterInitialSec.set(targetSec);
      if (!sameSeriesFamily) {
        relatedSeasons.set([]);
        seriesBaseTitle.set(baseTitle);
      }
      viewMode.set("theater");
      actorModalOpen.set(false);
      seasonsModalOpen.set(false);
      dramaDetailOpen.set(false);
    });

    // Kick off related-seasons discovery in parallel with `fetchSeriesDetail`!
    void loadSeasonsForSeries(summary, false);

    try {
      const detail = await fetchSeriesDetail(summary.series_id);
      if (seq !== openTheaterSeq) return;
      batch(() => {
        activeSeries.set(detail);
        loadingSeriesDetail.set(false);
      });
    } catch (err) {
      if (seq !== openTheaterSeq) return;
      batch(() => {
        loadingSeriesDetail.set(false);
        viewMode.set("catalog");
      });
      showToast(err instanceof Error ? err.message : "无法打开该剧目", "warning");
    }
  };

  const handleResumeHistoryEntry = (entry: WatchHistoryEntry) => {
    void openTheater(
      {
        series_id: entry.series_id,
        series_title: entry.series_title,
        cover: entry.cover,
        episode_count: entry.episode_count,
        category: "real-drama",
        tags: [],
        description: "",
      },
      entry.episode_index,
      entry.position_sec,
    );
  };

  const openActorModalById = async (actorId: string) => {
    actorModalOpen.set(true);
    loadingActorModal.set(true);
    try {
      const detail = await fetchActorDetail(actorId);
      activeActorDetail.set(detail);
    } finally {
      loadingActorModal.set(false);
    }
  };

  const handleImportLocal = async () => {
    try {
      const imported = await importLocalMediaFiles();
      if (imported) {
        showToast(`已导入《${imported.series_title}》`, "success");
        await openTheater(imported);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "导入本地文件失败", "warning");
    }
  };

  const handleApplyCustomUrl = async (url: string) => {
    const list = await loadCustomCatalogFromUrl(url);
    await updatePlayerPreferences({ customCatalogUrl: url });
    showToast(`已成功接入 ${list.length} 部剧目`, "success");
    switchTab("hot-drama");
  };

  const handleToggleFavoriteActive = () => {
    const cur = activeSeries();
    if (!cur) return;
    const { favorited } = toggleFavoriteSeries(cur);
    showToast(favorited ? "已加入收藏夹" : "已取消收藏");
  };

  return (
    <View class="flex-1 bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <If when={!isFullScreenTheater()}>
        <AppHeader
          currentTab={currentTab()}
          inTheater={viewMode() === "theater"}
          searchKeyword={searchDraft()}
          searchHistory={searchHistoryList()}
          appearance={preferences().appearance}
          searchInputRef={(node) => {
            searchInputRef = node;
          }}
          onGoHome={() => switchTab("hot-drama")}
          onSwitchTab={switchTab}
          onSearchKeywordChange={(v) => searchDraft.set(v)}
          onSubmitSearch={() => runSearch(searchDraft())}
          onSelectHistoryKeyword={runSearch}
          onRemoveHistoryKeyword={(kw) => void mutateSearchHistory("remove", kw)}
          onClearSearchHistory={() => void mutateSearchHistory("clear")}
          onImportLocalMedia={() => void handleImportLocal()}
          onOpenSourceModal={() => sourceModalOpen.set(true)}
          onCycleAppearance={() => {
            const next = cycleAppearance();
            showToast(
              next === "dark" ? "已切换至深色影院外观" : next === "light" ? "已切换至浅色纸感外观" : "已切换为跟随系统外观",
            );
          }}
          onOpenGalleryModal={() => galleryModalOpen.set(true)}
          onOpenShortcutsModal={() => shortcutsModalOpen.set(true)}
          onOpenAboutModal={() => aboutModalOpen.set(true)}
        />
      </If>

      <If
        when={viewMode() === "theater" ? activeSeries() : null}
        else={
          <If
            when={currentTab() === "actors"}
            else={
              <CatalogView
                currentTab={currentTab()}
                activeQuery={activeSearchQuery()}
                dramas={displayedCatalogDramas()}
                latestHistory={historyList()[0] ?? null}
                loading={catalogLoading()}
                error={catalogError()}
                page={catalogPage()}
                hasMore={catalogHasMore()}
                onQuickSearch={runSearch}
                onSelectDrama={(drama) => void openTheater(drama)}
                onResumeLatest={handleResumeHistoryEntry}
                onRemoveHistoryItem={(sid) => {
                  void removeHistorySeries(sid);
                  showToast("已从观看历史移除");
                }}
                onClearHistory={() => {
                  void clearWatchHistory();
                  showToast("已清空观看历史");
                }}
                onRefresh={() => {
                  catalogItems.set([]);
                  void loadCatalog(currentTab(), catalogPage(), activeSearchQuery(), { refresh: true });
                }}
                onRetry={() => void loadCatalog(currentTab(), catalogPage(), activeSearchQuery(), { refresh: true })}
                onChangePage={(delta) => {
                  const next = Math.max(1, catalogPage() + delta);
                  catalogItems.set([]);
                  void loadCatalog(currentTab(), next, activeSearchQuery());
                }}
              />
            }
          >
            <ActorRankingView
              actors={actors()}
              gender={actorGender()}
              rankDate={actorRankDate()}
              page={actorPage()}
              hasMore={actorHasMore()}
              loading={loadingActors()}
              onChangeGender={(g) => {
                actorGender.set(g);
                actors.set([]);
                void loadActors(g, 1);
              }}
              onChangePage={(delta) => {
                const next = Math.max(1, actorPage() + delta);
                actors.set([]);
                void loadActors(actorGender(), next);
              }}
              onSelectActor={(actor) => void openActorModalById(actor.actor_id)}
            />
          </If>
        }
      >
        {(series) => (
          <TheaterView
            series={series()}
            loadingSeriesDetail={loadingSeriesDetail()}
            initialEpisodeIndex={theaterInitialEp()}
            initialResumeSec={theaterInitialSec()}
            isFavorited={isSeriesFavorited(series().series_id)}
            prefs={preferences()}
            relatedSeasons={relatedSeasons()}
            baseTitle={seriesBaseTitle()}
            checkingSeasons={checkingSeasons()}
            hasModalOpen={hasAnyModalOpen()}
            onExitTheater={exitTheaterToCatalog}
            onToggleFavorite={handleToggleFavoriteActive}
            onOpenDramaDetail={() => dramaDetailOpen.set(true)}
            onOpenSeasonsModal={() => {
              seasonsModalOpen.set(true);
              if (relatedSeasons().length <= 1 && !checkingSeasons()) {
                void loadSeasonsForSeries(series(), true);
              }
            }}
            onRefreshSeasons={() => void loadSeasonsForSeries(series(), true)}
            onSelectSeason={(season) => void openTheater(season)}
          />
        )}
      </If>

      {/* Modals */}
      <DramaDetailModal
        open={dramaDetailOpen()}
        series={activeSeries()}
        isFavorited={activeSeries() ? isSeriesFavorited(activeSeries()!.series_id) : false}
        relatedSeasons={relatedSeasons()}
        onOpenChange={(open) => dramaDetailOpen.set(open)}
        onToggleFavorite={handleToggleFavoriteActive}
        onSelectSeason={(s) => void openTheater(s)}
        onOpenAllSeasons={() => {
          dramaDetailOpen.set(false);
          seasonsModalOpen.set(true);
          const cur = activeSeries();
          if (cur && relatedSeasons().length <= 1 && !checkingSeasons()) {
            void loadSeasonsForSeries(cur, true);
          }
        }}
        onSelectActor={(c) => {
          dramaDetailOpen.set(false);
          void openActorModalById(c.actor_id);
        }}
      />

      <SeasonsModal
        open={seasonsModalOpen()}
        baseTitle={seriesBaseTitle()}
        activeSeriesId={activeSeries()?.series_id}
        seasons={relatedSeasons()}
        loading={checkingSeasons()}
        onOpenChange={(open) => seasonsModalOpen.set(open)}
        onSelectSeason={(s) => void openTheater(s)}
        onSearchGlobally={(kw) => {
          seasonsModalOpen.set(false);
          runSearch(kw);
        }}
      />

      <ActorModal
        open={actorModalOpen()}
        actor={activeActorDetail()}
        loading={loadingActorModal()}
        onOpenChange={(open) => actorModalOpen.set(open)}
        onSwitchActor={(id) => void openActorModalById(id)}
        onPlayWork={(work) => void openTheater(work)}
      />

      <SourceConfigModal
        open={sourceModalOpen()}
        currentUrl={preferences().customCatalogUrl}
        onOpenChange={(open) => sourceModalOpen.set(open)}
        onApplyUrl={handleApplyCustomUrl}
        onImportLocal={() => void handleImportLocal()}
      />

      <ShortcutsModal open={shortcutsModalOpen()} onOpenChange={(open) => shortcutsModalOpen.set(open)} />

      <UiGalleryModal
        open={galleryModalOpen()}
        onOpenChange={(open) => galleryModalOpen.set(open)}
        onToggleAppearance={() => {
          cycleAppearance();
        }}
      />

      <AboutModal open={aboutModalOpen()} onOpenChange={(open) => aboutModalOpen.set(open)} />

      <UiToastHost />
    </View>
  );
}

if (desktopWindowAvailable) {
  Application.on("quit", () => shutdownHongguoEngine());
}
if (
  (platform.os === "windows" || platform.os === "macos" || platform.os === "linux") &&
  platform.idiom !== "terminal"
) {
  registerSourceAdapter(createHongguoSource());
}
mount(App);
