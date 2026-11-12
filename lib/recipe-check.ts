// recipe_id が API 側 (v5) の索引にあるかを、生成を走らせずに確かめる。
//
// フロントの索引 (public/data/glaze-index.json、21,046 件) は API 側の索引 (14,365 件) より広く、
// API 側に無い ID を送ると「recipe_id が索引に無い」で焼成が失敗する。GPU の確保待ちのあとで
// 失敗するのを避けるため、「釉薬から選ぶ」で組み合わせを確定した時点で先に確かめる。
//
// 確かめ方 (2026-11-05 本番で実測): 深度を付けずに recipe_id だけ送る。
// v5 は入力の検査をモデルの読み込みより前に行い、recipe_id の照合は深度の検査より先なので、
//   - 索引に無い → ValueError「recipe_id が索引に無い: ...」
//   - 索引にある → ValueError「depth_png (base64 PNG) か depth_preset が要る」
// のどちらかで必ず FAILED になり、生成は始まらない (worker の実行 約 0.3 秒、温まっていれば往復 1〜3 秒)。
//
// ⚠ 検査の順序は仕様書 (docs/api/serverless_api_v5.md) に書かれていない挙動。
// 変わって見分けられなくなったら "unknown" を返す (呼び出し側は焼成に進ませず、再確認を促す)。
// フロントの索引を API 側の ID 一覧で作り直せば、この確認は要らなくなる。

import { createQueueWatch, fetchEndpointHealth } from "./endpoint-health";
import { GENERATE_V5_QUERY } from "./generate_v5";
import type { JobStatus } from "./glaze_prompt";

// 確認 1 件の待ち上限。超えたら "unknown" (画面は「確認できませんでした」を出して再確認を促す)。
// 焼成 (15 分) と同じだけ待つと、worker の確保待ちの間ずっと FIRE が押せないままになる
const CHECK_LIMIT_MS = 2 * 60 * 1000;
// 温まっていれば 1〜3 秒で終わるので、焼成 (1 秒) より細かく見る
const CHECK_POLL_MS = 500;

// "unavailable": 生成サーバーに worker が 1 台もいない (待っても確かめられない。lib/endpoint-health.ts)
export type RecipeIdCheck = "ok" | "missing" | "unknown" | "unavailable";

type CheckJob = {
  id?: string;
  status?: JobStatus;
  output?: unknown;
};

// 一度確かめた ID は覚えておく (同じ組み合わせを選び直したときに API を叩かない)
const known = new Map<string, "ok" | "missing">();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * recipe_id が API 側の索引にあるか。確かめられなかったとき (通信失敗・中断・未設定など) は "unknown"。
 * /run で投入して /status を見る (/runsync は worker がいないと 90 秒返らない)。
 * 順番待ちが続いて worker が 1 台もいないと分かったら "unavailable" (投入から約 20 秒)
 */
export async function checkRecipeId(id: string, signal: AbortSignal): Promise<RecipeIdCheck> {
  const cached = known.get(id);
  if (cached) return cached;

  let jobId: string | undefined;
  try {
    const res = await fetch(`/api/generate${GENERATE_V5_QUERY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ glaze: { recipe_id: id } }),
      signal,
    });
    if (!res.ok) return "unknown";
    let job = (await res.json()) as CheckJob;
    jobId = job.id;

    const watch = createQueueWatch(() => fetchEndpointHealth("v5", signal));
    const startedAt = Date.now();
    while (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS" || job.status === "RUNNING") {
      if (!jobId || Date.now() - startedAt > CHECK_LIMIT_MS) break;
      await sleep(CHECK_POLL_MS, signal);
      if (signal.aborted) break;
      const poll = await fetch(`/api/generate/${jobId}${GENERATE_V5_QUERY}`, { signal });
      if (!poll.ok) continue; // proxy の一時的な失敗は次のポーリングに任せる
      job = (await poll.json()) as CheckJob;
      if (job.status === "IN_QUEUE" && (await watch.queued())) {
        cancel(jobId);
        return "unavailable";
      }
    }

    if (job.status === "FAILED") {
      const output = job.output as { message?: unknown } | undefined;
      const message = typeof output?.message === "string" ? output.message : "";
      if (message.includes("recipe_id が索引に無い")) {
        known.set(id, "missing");
        return "missing";
      }
      // recipe_id の照合を通って、深度が無いことで止まった = 索引にある
      if (message.includes("depth_png") || message.includes("depth_preset")) {
        known.set(id, "ok");
        return "ok";
      }
      return "unknown";
    }
    // 終わらなかった (中断・上限超え) ときは RunPod 側のジョブも止める
    if (jobId && job.status !== "COMPLETED") cancel(jobId);
    return "unknown";
  } catch {
    if (jobId) cancel(jobId);
    return "unknown";
  }
}

function cancel(jobId: string) {
  fetch(`/api/generate/${jobId}${GENERATE_V5_QUERY}`, { method: "DELETE" }).catch(() => {});
}

// 1 つの組み合わせで確かめる ID の上限 (1 件ずつ順に確かめる。1 件あたり往復 1〜3 秒)。
// 候補は中央値 1 件・90% が 7 件以下。2026-11-05 の抜き取りでは、API 側にある組み合わせは
// 候補の 3〜8 割が見つかり、無い組み合わせは全滅だった。12 件続けて無ければ「無い」とみなす
const MAX_CHECKS = 12;

export type FirableRecipe =
  | { status: "ok"; recipeId: string }
  /** 確かめた候補がどれも API 側の索引に無い */
  | { status: "none" }
  /** 確かめられなかった */
  | { status: "unknown" }
  /** 生成サーバーに worker が 1 台もいない */
  | { status: "unavailable" };

/**
 * 候補の ID を 1 件ずつ確かめて、API 側の索引にある最初の 1 件を返す。
 * 確かめる順は毎回ランダム (隣り合う ID は有無が揃いやすいので、連番では確かめない)
 */
export async function findFirableRecipe(
  ids: string[],
  signal: AbortSignal
): Promise<FirableRecipe> {
  if (ids.length === 0) return { status: "unknown" };
  const order = [...ids];
  const count = Math.min(order.length, MAX_CHECKS);
  for (let k = 0; k < count; k++) {
    // 先頭 count 件だけ並べ替える (Fisher–Yates の途中まで)
    const j = k + Math.floor(Math.random() * (order.length - k));
    [order[k], order[j]] = [order[j], order[k]];
    const id = order[k];
    const result = await checkRecipeId(id, signal);
    if (signal.aborted || result === "unknown") return { status: "unknown" };
    if (result === "unavailable") return { status: "unavailable" };
    if (result === "ok") return { status: "ok", recipeId: id };
  }
  return { status: "none" };
}
