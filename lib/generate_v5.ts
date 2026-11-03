// KESHIKI v5 生成 API (深度画像 → 器の画像) の I/O 契約と、UI 状態からの組み立て。
// 正本: docs/api/serverless_api_v5.md (2026-10-09 推定レシピ項目追加版) と
//       docs/api/serverless_api_progress.md (生成途中の絵 `preview`、2026-10-12 試作)。
// endpoint は従来 (glaze_prompt.ts) と別。proxy には `?api=v5` を付けて投げる。

import type { FiringUiState } from "./firing-request";
import type { GenerateError, JobStatus } from "./glaze_prompt";

export const GENERATE_V5_QUERY = "?api=v5";

// ---- 入力 ----

export type Soji = "SojiToki" | "SojiJiki" | "SojiAkatsuchi" | "SojiOther";
export type Shosei = "ShouseiSanka" | "ShouseiKangen";
export type Hyomen = "HyomenKotaku" | "HyomenHanKotaku" | "HyomenTsuyakeshi";
export type YuseijoA =
  | "YuseijoAMFutoumei"
  | "YuseijoAYusyokuTomei"
  | "YuseijoAMushokuTomei";
export type YuseijoB =
  | "YuseijoBKinitsu"
  | "YuseijoBFukinnitsu"
  | "YuseijoBKessho"
  | "YuseijoBKannyu"
  | "YuseijoBLuster";

/** A. 条件と色から DB のいちばん近い実在レシピを選ぶ (UI の本線)。すべて省略可 */
export type GlazeBySelection = {
  soji?: Soji;
  shosei?: Shosei;
  hyomen?: Hyomen;
  yuseijo_a?: YuseijoA;
  yuseijo_b?: YuseijoB;
  color?: string; // #rrggbb
  /** 近い順の上位 k 件から seed で 1 つ選ぶ。既定 1 */
  top_k?: number;
};

/** B. レシピを直接指定 */
export type GlazeByRecipe = { recipe_id: string };

export type Scene = "window" | "studio";

export type GenParamsV5 = {
  seed?: number; // 既定 -1
  num_images?: number; // 1〜4
  // steps / guidance / refcontrol / glaze_scale は検証済みの既定値を使う (基本は触らない)
  steps?: number;
  guidance?: number;
  refcontrol?: number;
  glaze_scale?: number;
};

/**
 * 生成途中の絵を途中経過で受け取る設定 (serverless_api_progress.md 2)。
 * 入れなければ途中の絵は作られない。本番 endpoint 未反映 (2026-10-15 時点)。
 */
export type PreviewParamsV5 = {
  every: number; // 1〜50。何ステップごとに送るか (生成は 30 ステップ)
  size: number; // 64〜1024。途中の絵の一辺 (px)。384 で約 12KB
};

/** POST /api/generate?api=v5 の JSON ボディ。depth_png か depth_preset のどちらか */
export type GenerateInputV5 = {
  depth_png?: string; // base64 PNG 1024x1024 (data URL 可)
  depth_preset?: string; // サーバー側のプリセット名 (試験用: sample_tall / sample_bowl / ...)
  glaze?: GlazeBySelection | GlazeByRecipe;
  scene?: Scene;
  gen_params?: GenParamsV5;
  preview?: PreviewParamsV5;
};

// ---- 出力 ----

export type GeneratedImageV5 = {
  url: string; // base64 data URL (R2 未設定)
  seed: number;
  elapsed_sec: number;
};

/** 釉名称 (DB のコードと日本語名・英訳)。1 レシピに複数つくことがある */
export type GlazeTypeV5 = { code: string; ja: string; en: string };

/**
 * ゼーゲル式 (mol)。KNaO〜PbO の 8 つが融剤で合計 1.0、Al2O3・SiO2・B2O3 は別。
 * 0 の酸化物も入っているので表示では 0 を省いてよい
 */
export type SegerV5 = Record<
  | "KNaO" | "Li2O" | "MgO" | "CaO" | "SrO" | "BaO" | "ZnO" | "PbO"
  | "Al2O3" | "SiO2" | "B2O3",
  number
>;

/** DB の「原料配合割合」(自由記述) を見出しで分けたもの */
export type FormulaV5 = {
  base: string | null; // 基礎釉の原料と割合 (DB の約 60% で null)
  additives: string | null; // 添加物と添加量 (約 20% で null)
  sections: { label: string; text: string }[]; // 見出し: 基礎釉 / 添加物 / 使用粘土 / 焼成条件 など
  text: string; // 原文
};

/** 選ばれた実在レシピ。焼成後のレシピ表示に使う (一般公開しない前提) */
export type RecipeV5 = {
  image_id: string;
  soji: Soji;
  shosei: Shosei;
  temp: number;
  hyomen: Hyomen;
  yuseijo_a: YuseijoA;
  yuseijo_b: YuseijoB;
  lab: [number, number, number];
  appearance_ja: string;
  appearance_en: string;
  /** 2026-10-09 追加の推定レシピ項目。無いときは空配列 / null */
  glaze_types: GlazeTypeV5[];
  seger: SegerV5 | null;
  formula: FormulaV5 | null;
  /** 指定色との距離 (CIEDE2000)。目安 15 以上なら「近い色がない」旨を出す。recipe_id 指定時は null */
  delta_e_to_color: number | null;
  /** 一致するレシピが無くて外した条件 */
  relaxed: string[];
  candidates: number;
};

/** 生成途中の絵 (その時点の完成予想)。JPEG の data URL */
export type PreviewFrameV5 = {
  step: number;
  steps?: number; // 途中経過にだけ入る (30)
  t?: number; // 完了時の previews にだけ入る (worker 受信からの秒)
  image: string;
};

/**
 * IN_PROGRESS の間に /status の output に入る途中経過。
 * - recipe: レシピを選んだ時点 (モデル読み込みや生成より前) で届く。焼成温度のカウンターはこれで目標を決める
 * - preview: 入力に preview を入れたときだけ。上書きで最後の 1 件しか見えないので 1 秒間隔で取る
 * - stage: recipe_selected → (cold なら読み込みの段階名) → generating
 */
export type ProgressV5 = {
  stage: string;
  t?: number; // worker が job を受け取ってからの秒
  recipe?: RecipeV5;
  preview?: PreviewFrameV5;
};

export type GenerateOutputV5 = {
  prompt_used: string;
  images: GeneratedImageV5[];
  recipe: RecipeV5;
  /** 入力に preview を入れたときだけ。途中の絵の全部 */
  previews?: PreviewFrameV5[];
  timeline?: { stage: string; t: number; index?: number }[];
  meta?: {
    backend?: string;
    scene?: Scene;
    depth?: {
      size?: [number, number];
      object_ratio?: number;
      object_std?: number;
      warning?: string;
    };
    [key: string]: unknown;
  };
};

export type JobStatusResponseV5 = {
  id: string;
  status: JobStatus;
  /** COMPLETED なら GenerateOutputV5、IN_PROGRESS なら ProgressV5 (古い worker では文字列のこともある)、FAILED なら message */
  output?: GenerateOutputV5 | ProgressV5 | GenerateError | { message?: string } | string;
  error?: string;
};

/** IN_PROGRESS の output が途中経過オブジェクトかどうか */
export function isProgressV5(o: unknown): o is ProgressV5 {
  return typeof o === "object" && o !== null && typeof (o as ProgressV5).stage === "string";
}

/** COMPLETED の output が生成結果かどうか */
export function isGenerateOutputV5(o: unknown): o is GenerateOutputV5 {
  return typeof o === "object" && o !== null && Array.isArray((o as GenerateOutputV5).images);
}

export const DELTA_E_FAR = 15;

// ---- 表示用ラベル (レシピ表示は日本語固定) ----

export const SOJI_LABEL: Record<Soji, string> = {
  SojiToki: "陶器",
  SojiJiki: "磁器",
  SojiAkatsuchi: "赤土",
  SojiOther: "その他",
};
export const SHOSEI_LABEL: Record<Shosei, string> = {
  ShouseiSanka: "酸化",
  ShouseiKangen: "還元",
};
export const HYOMEN_LABEL: Record<Hyomen, string> = {
  HyomenKotaku: "光沢",
  HyomenHanKotaku: "半光沢",
  HyomenTsuyakeshi: "つや消し",
};
export const YUSEIJO_A_LABEL: Record<YuseijoA, string> = {
  YuseijoAMFutoumei: "不透明",
  YuseijoAYusyokuTomei: "有色透明",
  YuseijoAMushokuTomei: "無色透明",
};
export const YUSEIJO_B_LABEL: Record<YuseijoB, string> = {
  YuseijoBKinitsu: "均一",
  YuseijoBFukinnitsu: "不均一",
  YuseijoBKessho: "結晶",
  YuseijoBKannyu: "貫入",
  YuseijoBLuster: "ラスター",
};

// ---- UI 状態 → glaze ----

// 素地名 (lib/clay.ts の name) → soji
function sojiOf(clay: string): Soji {
  if (clay === "磁器") return "SojiJiki";
  if (clay.includes("赤土")) return "SojiAkatsuchi";
  return "SojiToki";
}

/** Step-1 で決まる条件 (素地・焼成雰囲気)。釉薬の絞り込みと実在レシピの選択に使う */
export function baseConditionsOf(
  ui: Pick<FiringUiState, "clay" | "atmosphere">
): { soji: Soji; shosei: Shosei } {
  return {
    soji: sojiOf(ui.clay),
    shosei: ui.atmosphere.includes("還元") ? "ShouseiKangen" : "ShouseiSanka",
  };
}

/**
 * 現行 UI の選択状態 → v5 の glaze。
 * - 見た目からつくる: 色 + 表面状態/透明度/質感 (UI が v5 の分類をそのまま持つ)
 * - 釉薬から選ぶ: 本線は実在レシピ (recipe_id) で焼く (FiringPanel が索引から選ぶ)。
 *   索引に見つからなかったときの保険として、素地・焼成と選択中の色だけを送る
 * - 言葉からつくる: v5 に自由文の口がないため、素地・焼成と選択中の色だけを送る
 */
export function buildGlazeV5(ui: FiringUiState): GlazeBySelection {
  const glaze: GlazeBySelection = { ...baseConditionsOf(ui) };
  if (ui.glaze) glaze.color = ui.glaze.hex;
  if (ui.mode !== "visual") return glaze;

  glaze.hyomen = ui.hyomen;
  glaze.yuseijo_a = ui.yuseijoA;
  glaze.yuseijo_b = ui.yuseijoB;
  return glaze;
}

/** 焼成演出用の途中の絵の既定 (3 ステップごと = 10 枚、384px)。progress 仕様書の例と同じ */
export const DEFAULT_PREVIEW_V5: PreviewParamsV5 = { every: 3, size: 384 };

export function buildGenerateInputV5(
  ui: FiringUiState,
  depth: { depth_png: string } | { depth_preset: string },
  options: {
    scene?: Scene;
    /** 選択済みの実在レシピ (Step-2B / 2C)。指定時は条件からの検索ではなくこれで焼く */
    recipeId?: string;
    /**
     * 途中の絵を受け取る設定。省略で送らない。
     * ⚠ 本番 endpoint 未反映のうちに送ると「知らないキー preview」で FAILED になる
     * (v5 は知らないキーをエラーにする方針)。呼び出し側で対応可否を見て付ける
     */
    preview?: PreviewParamsV5;
  } = {}
): GenerateInputV5 {
  const input: GenerateInputV5 = {
    ...depth,
    glaze: options.recipeId ? { recipe_id: options.recipeId } : buildGlazeV5(ui),
    scene: options.scene ?? "window",
    gen_params: { seed: -1, num_images: 1 },
  };
  if (options.preview) input.preview = options.preview;
  return input;
}
