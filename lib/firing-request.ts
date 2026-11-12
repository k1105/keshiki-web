import type { GlazeColor } from "./colors";
import {
  HYOMEN_LABEL,
  YUSEIJO_A_LABEL,
  YUSEIJO_B_LABEL,
  type Hyomen,
  type YuseijoA,
  type YuseijoB,
} from "./generate_v5";
import { glazeStyleByCode } from "./glaze-styles";
import {
  DEFAULT_ANCHOR,
  type GenerateInput,
  type SegerValues,
  type Selections,
} from "./glaze_prompt";

// 現行 UI (page.tsx) の選択状態 → 本番リクエスト (GenerateInput) へのマッピング。
//
// selections のカテゴリ名/選択肢の正本は本番リポジトリの
// web/public/data/maintable_choices.json (日本語キー)。繋ぎこみガイドで
// 例示されている「焼成: 酸化」「素地: 磁器土」だけを selections で送り、
// 選択肢名が未確認の項目 (素地=陶器、透明感、光沢、表情など) は
// comment_ja の日本語文に畳み込んでワーカー側の翻訳・自動選択に委ねる。
// maintable_choices.json を入手したら selections への昇格を検討すること。

export type FiringMode = "visual" | "style" | "mood";

export type FiringUiState = {
  mode: FiringMode;
  glaze: GlazeColor | null;
  // 見た目からつくる: 表面状態 / 透明度 / 質感 (v5 の分類そのもの)。
  // 3 つとも UI から外した (2026-11-12、色だけで選ぶ)。指定があるときだけ条件に入れる
  hyomen?: Hyomen;
  yuseijoA?: YuseijoA;
  yuseijoB?: YuseijoB;
  // 釉薬から選ぶ: 釉名称コード (A01..G12、複数可)
  glazeCodes: string[];
  /** 釉薬から選ぶ: API 側の索引にあると確かめた実在レシピ (lib/recipe-check.ts)。あればこれで焼く */
  glazeRecipeId?: string | null;
  mood: string;
  /** 感覚でつくる: 自由探索 (text_search) で確定した実在レシピ。これで焼く */
  moodRecipeId?: string | null;
  /**
   * 焼く実在レシピの焼成最高温度 (釉薬から選ぶ / 感覚でつくる で、焼成前に分かっているとき)。
   * 温度カウンターの目標に使う。分からなければ null
   */
  recipeTemp?: number | null;
  // 素地・焼成雰囲気は UI では選ばない (2026-11-12)。指定があるときだけ条件に入れる
  clay?: string; // 磁器 / 陶器（白土） / 陶器（赤土）
  atmosphere?: string; // 酸化焼成 / 還元焼成
  temp: number; // 1100-1300
};

// FiringModal の「ゼーゲル式（概算）」表示と同じ値をリクエストにも送る。
// idx はワーカーが期待する数値インデックス (glaze_prompt.ts の SegerValues 参照)、
// label はモーダル表示用
export const SEGER_ROWS = [
  { idx: 1, label: "KNaO", mol: 0.3 },
  { idx: 4, label: "CaO", mol: 0.45 },
  { idx: 3, label: "MgO", mol: 0.05 },
  { idx: 11, label: "B₂O₃", mol: 0.2 },
  { idx: 9, label: "Al₂O₃", mol: 0.35 },
  { idx: 10, label: "SiO₂", mol: 3.2 },
] as const;

function segerValues(): SegerValues {
  const values: SegerValues = {};
  for (const row of SEGER_ROWS) values[row.idx] = row.mol;
  return values;
}

// UI の視覚パラメータを comment_ja 用の日本語句に起こす
function visualComment(ui: FiringUiState): string {
  const parts: string[] = [];
  if (ui.yuseijoA) parts.push(YUSEIJO_A_LABEL[ui.yuseijoA]);
  if (ui.hyomen) parts.push(HYOMEN_LABEL[ui.hyomen]);
  if (ui.yuseijoB) parts.push(`${YUSEIJO_B_LABEL[ui.yuseijoB]}な質感`);
  return parts.length > 0 ? `${parts.join("、")}の釉薬` : "釉薬";
}

export function buildGenerateInput(ui: FiringUiState): GenerateInput {
  const selections: Selections = {};

  // 酸化焼成/還元焼成 → 選択肢名は「酸化」「還元」(ガイドに酸化の例示あり)
  if (ui.atmosphere) selections["焼成"] = [ui.atmosphere.includes("還元") ? "還元" : "酸化"];
  // 素地はガイドで例示のある磁器土のみ selections で送る。陶器（白土/赤土）の
  // 選択肢名は maintable_choices.json 未入手のため comment_ja に畳み込む
  if (ui.clay === "磁器") selections["素地"] = ["磁器土"];

  const commentParts: string[] = [];
  if (ui.mode === "mood" && ui.mood.trim()) {
    commentParts.push(ui.mood.trim());
  } else if (ui.mode === "style") {
    const names = ui.glazeCodes
      .map((code) => glazeStyleByCode(code)?.ja)
      .filter((n): n is string => !!n);
    commentParts.push(`${names.join("、")}の釉薬`);
  } else {
    commentParts.push(visualComment(ui));
  }
  if (ui.clay && ui.clay !== "磁器") commentParts.push(`${ui.clay}の素地`);
  commentParts.push(`${ui.temp}℃で焼成`);

  return {
    selections,
    seger_values: segerValues(),
    anchor: DEFAULT_ANCHOR,
    comment_ja: commentParts.join("。"),
    auto_comment: true,
    gen_params: {
      steps: 20,
      guidance: 15,
      width: 1024,
      height: 1024,
      seed: -1,
      num_images: 1,
    },
  };
}
