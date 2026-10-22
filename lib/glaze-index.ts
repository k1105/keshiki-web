// 釉薬データベース (MainTable) の索引を引く。
// 索引は scripts/build-glaze-index.py が public/data/glaze-index.json に生成する
// (約 850KB なので bundle に含めず、必要になった時点で fetch する)。
//
// 用途:
// - Step-2B: 現在の条件 + 選択済みコードと組み合わせて実データが 1 件以上ある釉薬だけを選べるようにする
// - Step-2B → v5: 条件に合う実在レシピ (画像ID) を 1 件選んで recipe_id で送る
// - Step-3: 焼成演出に使う焼成温度を実データから採る
//
// ⚠ 仮置き: 条件列のコード (01, 02, ...) と意味の対応表はデータベースに同梱されていない。
// v5 API (lib/generate_v5.ts) の列挙順と同じ並びで 01 から振られている前提で実装している。
// 岸さんに確認が取れたら、下の *_DIGIT を見直すこと。

import type {
  Hyomen,
  Shosei,
  Soji,
  YuseijoA,
  YuseijoB,
} from "./generate_v5";

export type GlazeIndexEntry = {
  /** 5 条件のコード末尾 1 桁 (素地, 焼成雰囲気, 表面状態, 釉性状１, 釉性状２)。不明は "?" */
  c: string;
  /** 釉名称コード (ソート済み) */
  g: string[];
  /** 画像ID (整数化。8 桁ゼロ埋めに戻して使う) */
  i: number[];
  /** i と同じ並びの焼成最高温度 (℃)。無い場合 0 */
  t: number[];
};

export type GlazeIndex = {
  source: string;
  rows: number;
  entries: GlazeIndexEntry[];
};

/** 索引に問い合わせる条件。省略した項目は絞り込まない */
export type GlazeConditions = {
  soji?: Soji;
  shosei?: Shosei;
  hyomen?: Hyomen;
  yuseijoA?: YuseijoA;
  yuseijoB?: YuseijoB;
};

export type GlazeRecipeRef = {
  /** 画像ID (8 桁ゼロ埋め)。v5 の recipe_id / RecipeV5.image_id と同じ形の想定 */
  imageId: string;
  /** 焼成最高温度 (℃)。データに無ければ 0 */
  temp: number;
  /** その行に付いている釉名称コード */
  codes: string[];
};

// ---- v5 の列挙 → 索引のコード桁 (仮置き。ファイル冒頭の注意を参照) ----

const SOJI_DIGIT: Record<Soji, string> = {
  SojiToki: "1",
  SojiJiki: "2",
  SojiAkatsuchi: "3",
  SojiOther: "4",
};
const SHOSEI_DIGIT: Record<Shosei, string> = {
  ShouseiSanka: "1",
  ShouseiKangen: "2",
};
const HYOMEN_DIGIT: Record<Hyomen, string> = {
  HyomenKotaku: "1",
  HyomenHanKotaku: "2",
  HyomenTsuyakeshi: "3",
  // "4" = 特殊 (仕様の Special Surface)。v5 に対応値が無いので UI には出さない
};
const YUSEIJO_A_DIGIT: Record<YuseijoA, string> = {
  YuseijoAMFutoumei: "1",
  YuseijoAYusyokuTomei: "2",
  YuseijoAMushokuTomei: "3",
};
const YUSEIJO_B_DIGIT: Record<YuseijoB, string> = {
  YuseijoBKinitsu: "1",
  YuseijoBFukinnitsu: "2",
  YuseijoBKessho: "3",
  YuseijoBKannyu: "4",
  YuseijoBLuster: "5",
};

/** 条件 → 5 桁パターン。絞り込まない桁は "." */
export function conditionPattern(cond: GlazeConditions): string {
  return [
    cond.soji ? SOJI_DIGIT[cond.soji] : ".",
    cond.shosei ? SHOSEI_DIGIT[cond.shosei] : ".",
    cond.hyomen ? HYOMEN_DIGIT[cond.hyomen] : ".",
    cond.yuseijoA ? YUSEIJO_A_DIGIT[cond.yuseijoA] : ".",
    cond.yuseijoB ? YUSEIJO_B_DIGIT[cond.yuseijoB] : ".",
  ].join("");
}

function matchesPattern(c: string, pattern: string): boolean {
  for (let k = 0; k < 5; k++) {
    const p = pattern[k];
    // 絞り込む桁は一致が必要。索引側が不明 ("?") の行は絞り込み対象の条件には合わない
    if (p !== "." && c[k] !== p) return false;
  }
  return true;
}

function hasAllCodes(entry: GlazeIndexEntry, codes: string[]): boolean {
  for (const code of codes) if (!entry.g.includes(code)) return false;
  return true;
}

export function imageIdOf(n: number): string {
  return String(n).padStart(8, "0");
}

// ---- 問い合わせ ----

/**
 * 現在の条件と選択済みコードの両方を満たす実データが 1 件以上ある釉名称コードの集合。
 * 仕様 (step-2B): 「選べるもの = 現在の条件と組み合わせた実データが 1 件以上存在するもの」。
 * 選択済みコード自身も含まれる (= 選び直し可能)。
 */
export function availableGlazeCodes(
  index: GlazeIndex,
  cond: GlazeConditions,
  selected: string[] = []
): Set<string> {
  const pattern = conditionPattern(cond);
  const out = new Set<string>();
  for (const e of index.entries) {
    if (e.g.length === 0) continue;
    if (!matchesPattern(e.c, pattern)) continue;
    if (!hasAllCodes(e, selected)) continue;
    for (const code of e.g) out.add(code);
  }
  return out;
}

/** 条件と選択済みコードをすべて満たす実在レシピの一覧 */
export function findGlazeRecipes(
  index: GlazeIndex,
  cond: GlazeConditions,
  selected: string[] = []
): GlazeRecipeRef[] {
  const pattern = conditionPattern(cond);
  const out: GlazeRecipeRef[] = [];
  for (const e of index.entries) {
    if (!matchesPattern(e.c, pattern)) continue;
    if (!hasAllCodes(e, selected)) continue;
    for (let k = 0; k < e.i.length; k++) {
      out.push({ imageId: imageIdOf(e.i[k]), temp: e.t[k], codes: e.g });
    }
  }
  return out;
}

/**
 * 条件と選択済みコードに合う実在レシピを 1 件選ぶ。無ければ null。
 * seed を渡すと同じ候補集合から同じ 1 件が選ばれる (省略時はランダム)。
 */
export function pickGlazeRecipe(
  index: GlazeIndex,
  cond: GlazeConditions,
  selected: string[] = [],
  seed?: number
): GlazeRecipeRef | null {
  const list = findGlazeRecipes(index, cond, selected);
  if (list.length === 0) return null;
  const r = seed === undefined ? Math.random() : seededUnit(seed);
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

// 0 以上 1 未満の決定的な擬似乱数 (mulberry32 の 1 ステップ)
function seededUnit(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- 読み込み ----

export const GLAZE_INDEX_URL = "/data/glaze-index.json";

let cached: Promise<GlazeIndex> | null = null;

/** 索引を 1 度だけ fetch してキャッシュする。失敗時はキャッシュを捨てて次回再試行 */
export function loadGlazeIndex(): Promise<GlazeIndex> {
  if (!cached) {
    cached = fetch(GLAZE_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`glaze index: HTTP ${res.status}`);
        return res.json() as Promise<GlazeIndex>;
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
