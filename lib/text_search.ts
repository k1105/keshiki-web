// KESHIKI 自由探索 API (自由文 → 近い実在テストピース) の I/O 契約とクライアント。
// 正本: docs/api/serverless_api_text_search.md (2026-10-12 試作)。
// v5 endpoint に `op: "text_search"` を送る。返った recipe_id をそのまま v5 の glaze.recipe_id に渡せば
// そのテストピースの釉で器が焼ける (DB に無い組み合わせは作らない方針)。
// ⚠ 2026-10-15 時点で本番 endpoint 未反映 (送ると「知らないキー op」で FAILED)。

import type { GlazeBySelection, GlazeTypeV5, Hyomen, Shosei, Soji, YuseijoA, YuseijoB } from "./generate_v5";
import { createQueueWatch, fetchEndpointHealth, NO_WORKERS } from "./endpoint-health";
import type { GenerateError, JobStatus } from "./glaze_prompt";
import { liveJobClient } from "./job-client";

export type TextSearchFilters = Pick<GlazeBySelection, "soji" | "shosei" | "hyomen" | "yuseijo_a" | "yuseijo_b">;

export type TextSearchInput = {
  op: "text_search";
  text: string; // 1〜200 文字
  top_k?: number; // 1〜20、既定 5
  /** Step-1 の分類で絞る。0 件なら絞らずに返し relaxed に外したキーが入る */
  filters?: TextSearchFilters;
  rewrite?: boolean; // 既定 true。false で言い換えなし (速いが比喩に弱い)
};

export type TextSearchResult = {
  recipe_id: string;
  score: number;
  appearance_ja: string;
  appearance_en: string;
  soji: Soji;
  shosei: Shosei;
  temp: number;
  hyomen: Hyomen;
  yuseijo_a: YuseijoA;
  yuseijo_b: YuseijoB;
  glaze_types: GlazeTypeV5[];
  /** テストピースの平均色 #rrggbb。候補の色見本に使える */
  color: string;
};

export type TextSearchOutput = {
  text: string;
  /** 言い換えの結果 (「こう読み取りました」の表示に使える)。rewrite: false なら null */
  rewrite: { description: string; color: string } | null;
  /** 文から見つけた様式名 (例 ["天目"]) */
  style_filter: string[];
  relaxed: string[];
  results: TextSearchResult[];
  sec?: { rewrite: number; search: number };
  meta?: { load_sec?: number; image_tag?: string; [key: string]: unknown };
};

type TextSearchJob = {
  id: string;
  status: JobStatus;
  output?: TextSearchOutput | GenerateError | { message?: string } | string;
  error?: string;
};

export const TEXT_SEARCH_MAX_CHARS = 200;

export function buildTextSearchInput(
  text: string,
  options: { topK?: number; filters?: TextSearchFilters; rewrite?: boolean } = {}
): TextSearchInput {
  const input: TextSearchInput = { op: "text_search", text: text.trim().slice(0, TEXT_SEARCH_MAX_CHARS) };
  if (options.topK) input.top_k = options.topK;
  if (options.filters && Object.keys(options.filters).length > 0) input.filters = options.filters;
  if (options.rewrite === false) input.rewrite = false;
  return input;
}

function isTextSearchOutput(o: unknown): o is TextSearchOutput {
  return typeof o === "object" && o !== null && Array.isArray((o as TextSearchOutput).results);
}

const POLL_MS = 500; // 温まっていれば 1〜2 秒で終わるので、焼成 (1 秒) より細かく見る
const POLL_LIMIT_MS = 2 * 60 * 1000; // 初めて使う worker は読み込みに 9〜25 秒 + 確保待ち

/**
 * 自由探索を実行して結果を返す。温まっていれば 1〜2 秒。
 * /run で投入して /status を見る (/runsync は worker がいないと 90 秒返らず、途中で止められない)。
 * 順番待ちが続いて worker が 1 台もいないと分かったら、上限を待たずに NO_WORKERS で失敗にする
 * (lib/endpoint-health.ts。投入から約 20 秒)。
 * 失敗は GenerateError を throw する。
 */
export async function textSearch(
  input: TextSearchInput,
  signal?: AbortSignal
): Promise<TextSearchOutput> {
  const client = liveJobClient;
  const submitted = await client.submit("v5", input, signal);
  if (!submitted.ok) throw submitted.error;
  const id = submitted.id;
  const watch = createQueueWatch(() => fetchEndpointHealth("v5", signal));
  const startedAt = Date.now();

  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (signal?.aborted) throw { error: "aborted" } as GenerateError;
      if (Date.now() - startedAt > POLL_LIMIT_MS) throw { error: "client_timeout" } as GenerateError;
      const res = await client.status("v5", id, signal);
      if (!res.ok) throw res.error;
      const job = res.data as TextSearchJob;
      if (job.status === "IN_QUEUE") {
        if (await watch.queued()) throw { error: NO_WORKERS } as GenerateError;
        continue;
      }
      if (job.status === "IN_PROGRESS" || job.status === "RUNNING") continue;
      if (job.status === "COMPLETED" && isTextSearchOutput(job.output)) return job.output;
      const output = job.output as { message?: string } | undefined;
      // ここに来るのは終わったジョブ (FAILED など) だけなので、キャンセルは要らない
      return Promise.reject({
        error: job.error ?? job.status,
        message: typeof output?.message === "string" ? output.message : undefined,
      } as GenerateError);
    }
  } catch (e) {
    // 終わる前に抜けた (中断・時間切れ・worker がいない・通信失敗) ときは RunPod 側のジョブも止める
    client.cancel("v5", id);
    throw e;
  }
}

/** 疑似応答 (?mock=1)。本番 endpoint に text_search が入るまでの演出確認用。温まった worker と同じ 1.5 秒で返す */
export async function mockTextSearch(input: TextSearchInput, speed = 1): Promise<TextSearchOutput> {
  await new Promise((r) => setTimeout(r, 1500 / speed));
  // 候補の見た目を確かめられるよう、色と温度を少しずつ変えて top_k 件返す
  const colors = ["#2f6d5f", "#3f7f8f", "#6d8f4f", "#1f4d5f", "#8fa58f"];
  const count = Math.min(input.top_k ?? 5, colors.length);
  return {
    text: input.text,
    rewrite: { description: "光沢のある深い緑色の釉", color: "#2f6d5f" },
    style_filter: [],
    relaxed: [],
    results: colors.slice(0, count).map((color, k) => (
      {
        recipe_id: `mock-text-search-${k}`,
        score: 0.88 - k * 0.03,
        appearance_ja: "つやのある深い緑色の釉",
        appearance_en: "Glossy deep green glaze",
        soji: input.filters?.soji ?? "SojiToki",
        shosei: input.filters?.shosei ?? "ShouseiSanka",
        temp: 1240 - k * 20,
        hyomen: "HyomenKotaku",
        yuseijo_a: "YuseijoAYusyokuTomei",
        yuseijo_b: "YuseijoBKinitsu",
        glaze_types: [
          { code: "A01", ja: "長石釉", en: "Feldspathic glaze" },
          { code: "C02", ja: "織部釉", en: "Oribe glaze" },
        ],
        color,
      }
    )),
  };
}
