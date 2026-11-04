// KESHIKI 自由探索 API (自由文 → 近い実在テストピース) の I/O 契約とクライアント。
// 正本: docs/api/serverless_api_text_search.md (2026-10-12 試作)。
// v5 endpoint に `op: "text_search"` を送る。返った recipe_id をそのまま v5 の glaze.recipe_id に渡せば
// そのテストピースの釉で器が焼ける (DB に無い組み合わせは作らない方針)。
// ⚠ 2026-10-15 時点で本番 endpoint 未反映 (送ると「知らないキー op」で FAILED)。

import type { GlazeBySelection, GlazeTypeV5, Hyomen, Shosei, Soji, YuseijoA, YuseijoB } from "./generate_v5";
import { GENERATE_V5_QUERY } from "./generate_v5";
import { isGenerateError, type GenerateError, type JobStatus } from "./glaze_prompt";

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

const POLL_MS = 1000;
const POLL_LIMIT_MS = 2 * 60 * 1000; // 初めて使う worker は読み込みに 9〜25 秒 + 確保待ち

/**
 * 自由探索を実行して結果を返す。温まっていれば 1〜2 秒。
 * /runsync で待ち、90 秒を超えて IN_PROGRESS のまま返ったら /status を取りにいく。
 * 失敗は GenerateError を throw する。
 */
export async function textSearch(
  input: TextSearchInput,
  signal?: AbortSignal
): Promise<TextSearchOutput> {
  const res = await fetch(`/api/generate${GENERATE_V5_QUERY}&sync=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  let job: TextSearchJob & GenerateError = await res.json();
  if (!res.ok) throw (isGenerateError(job) ? job : { error: "pod_api_error", message: String(res.status) });

  const startedAt = Date.now();
  while (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS" || job.status === "RUNNING") {
    if (Date.now() - startedAt > POLL_LIMIT_MS) {
      fetch(`/api/generate/${job.id}${GENERATE_V5_QUERY}`, { method: "DELETE" }).catch(() => {});
      throw { error: "client_timeout" } as GenerateError;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (signal?.aborted) throw { error: "aborted" } as GenerateError;
    const poll = await fetch(`/api/generate/${job.id}${GENERATE_V5_QUERY}`, { signal });
    job = await poll.json();
    if (!poll.ok) throw (isGenerateError(job) ? job : { error: "pod_api_error" });
  }

  if (job.status === "COMPLETED" && isTextSearchOutput(job.output)) return job.output;
  const output = job.output as { message?: string } | undefined;
  throw {
    error: job.error ?? job.status,
    message: typeof output?.message === "string" ? output.message : undefined,
  } as GenerateError;
}

/** 疑似応答 (?mock=1)。本番 endpoint に text_search が入るまでの演出確認用。温まった worker と同じ 1.5 秒で返す */
export async function mockTextSearch(input: TextSearchInput, speed = 1): Promise<TextSearchOutput> {
  await new Promise((r) => setTimeout(r, 1500 / speed));
  return {
    text: input.text,
    rewrite: { description: "光沢のある深い緑色の釉", color: "#2f6d5f" },
    style_filter: [],
    relaxed: [],
    results: [
      {
        recipe_id: "mock-text-search",
        score: 0.88,
        appearance_ja: "つやのある深い緑色の釉",
        appearance_en: "Glossy deep green glaze",
        soji: input.filters?.soji ?? "SojiToki",
        shosei: input.filters?.shosei ?? "ShouseiSanka",
        temp: 1240,
        hyomen: "HyomenKotaku",
        yuseijo_a: "YuseijoAYusyokuTomei",
        yuseijo_b: "YuseijoBKinitsu",
        glaze_types: [
          { code: "A01", ja: "長石釉", en: "Feldspathic glaze" },
          { code: "C02", ja: "織部釉", en: "Oribe glaze" },
        ],
        color: "#2f6d5f",
      },
    ],
  };
}
