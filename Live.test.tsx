import process from "process";
import { expect, open, test } from "nsh/test";

const liveTest = process.env.HONGGUO_LIVE_TEST === "1" ? test : test.skip;
liveTest("Windows native playback uses the real Hongguo source and preloads three episodes", async () => {
  const app = await open("./App.tsx", { width: 1280, height: 840, network: "live" });
  await app.waitFor("id:search-input");

  // 1. Verify homepage `热门榜单` loads real cards (not empty state)
  await app.waitUntil(() => app.texts().some(t => /集/.test(t)) && !app.shows("暂无相关短剧内容"), { timeout: 25000 });
  expect(app.shows("暂无相关短剧内容")).toBe(false);

  // 2. Verify category tab `真人短剧` loads real cards
  await app.press("🎭 真人短剧");
  await app.waitUntil(() => app.texts().some(t => /集/.test(t)) && !app.shows("暂无相关短剧内容"), { timeout: 25000 });
  expect(app.shows("短剧加载失败")).toBe(false);

  // 3. Verify `剧星榜` actor ranking loads real cards
  await app.press("🌟 剧星榜");
  await app.waitUntil(() => app.texts().some(t => /人气|作品/.test(t)) && !app.shows("暂无剧星榜数据"), { timeout: 25000 });

  await app.press("🔥 热门榜单");
  await app.type("id:search-input", "一梦青玄，团宠小师妹一剑毁天灭地第三季");
  await app.press("id:search-submit-btn");
  await app.waitFor("id:drama-card-7673461357148130329", { timeout: 30000 });
  const started = Date.now();
  await app.press("id:drama-card-7673461357148130329");
  await app.waitFor("第 1 集 / 全 186 集", { timeout: 30000 });
  await app.waitUntil(() => app.texts().some(text => /^00:0[3-9]\s*\//.test(text)), { timeout: 120000 });
  console.log(`NSH_PLAYBACK_TIMING click_to_three_seconds_ms=${Date.now() - started}`);
  await app.screenshot(".nsh/test/hongguo-third-season.png");
  await app.press("id:play-pause-btn");
  await app.waitFor("预载 3/3 集", { timeout: 120000 });
  await app.keyboard.press("right");
  await app.keyboard.press("right");
  await app.press("id:play-pause-btn");
  await app.waitUntil(() => app.texts().some(text => /^00:[1-5][0-9]\s*\//.test(text)), { timeout: 15000 });
  const switched = Date.now();
  await app.press("id:next-episode-btn");
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(app.shows("正在缓冲画面...")).toBe(false);
  await app.screenshot(".nsh/test/switch-1-to-2-15ms.png");
  await new Promise(resolve => setTimeout(resolve, 65));
  expect(app.shows("正在缓冲画面...")).toBe(false);
  await app.screenshot(".nsh/test/switch-1-to-2-80ms.png");
  await app.waitFor("第 2 集 / 全 186 集");
  await app.waitUntil(() => app.texts().some(text => /^00:0[3-9]\s*\//.test(text)), { timeout: 20000 });
  console.log(`NSH_PLAYBACK_TIMING cached_switch_to_three_seconds_ms=${Date.now() - switched}`);
  await app.screenshot(".nsh/test/hongguo-ep2-frame-a.png");
  await new Promise(resolve => setTimeout(resolve, 2600));
  await app.screenshot(".nsh/test/hongguo-ep2-frame-b.png");

  // Bidirectional switch `2 -> 1` (N-1 standby) + cached jump `1 -> 3` (local disk file `Fast Path 2`)
  await app.press("id:prev-episode-btn");
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(app.shows("正在缓冲画面...")).toBe(false);
  await app.screenshot(".nsh/test/switch-2-to-1-20ms.png");
  await app.waitFor("第 1 集 / 全 186 集");
  await app.waitUntil(() => app.texts().some(text => /^00:0[1-9]\s*\//.test(text)), { timeout: 10000 });

  await app.press("id:ep-btn-3");
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(app.shows("正在缓冲画面...")).toBe(false);
  await app.screenshot(".nsh/test/switch-1-to-3-40ms.png");
  await app.waitFor("第 3 集 / 全 186 集");
  await app.waitUntil(() => app.texts().some(text => /^00:0[1-9]\s*\//.test(text)), { timeout: 10000 });

  await app.press("id:open-seasons-modal-btn");
  await app.waitFor("共 9 季 · 已排好序", { timeout: 30000 });
  expect(app.shows("共 186 集")).toBe(true);
}, 240000);
