// 釉薬データベース (MainTable) の索引を引く。
// 索引は scripts/build-glaze-index.py が public/data/glaze-index.json に生成する
// (約 850KB なので bundle に含めず、必要になった時点で fetch する)。
//
// 用途:
// - Step-2B: 気になる釉薬を選ぶと、現在の条件でそれを含む実在の組み合わせを候補として並べる (findGlazeCombos)。
//   候補から 1 つを確定したものが「釉薬の組み合わせ」になる (以降の glazeCodes は常に実在する組み合わせそのもの)
// - Step-2B → v5: 確定した組み合わせと条件に合う実在レシピ (画像ID) を 1 件選んで recipe_id で送る
// - Step-3: 焼成演出に使う焼成温度を実データから採る
// - Step-2B: 確定した組み合わせの実データの代表色を器のプレビューに載せる (representativeGlazeColor)
//
// ⚠ 条件列のコード (01, 02, ...) と意味の対応表はデータベースに同梱されていない。
// 下の *_DIGIT は 2026-11-12 に MainTable xlsx の中身から推定したもの (岸さんの確定待ち):
// - 素地: 01 は原料配合に「磁器」が多く 1280〜1300℃、02 は「信楽」「赤土」が多い、03 は「瓦」が多く 1100℃
// - 釉性状１: 01 に「無色」、03 に「乳濁」が多い / 釉性状２: 03 に「ラスター」、04 に「結晶」、05 に「貫入」が多い
// - 件数の比も v5 仕様書 (docs/api/serverless_api_v5.md) の索引件数と合う
// 以前は v5 API の列挙順のまま 01 から振っていて、素地 (陶器/磁器)・釉性状１・釉性状２ がずれていた。

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
  /** i と同じ並びの代表色 (sRGB hex、"#" なし)。マンセル値が無い行は null。古い索引には無い */
  k?: (string | null)[];
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
  /** 代表色 (#rrggbb)。データに無ければ null */
  hex: string | null;
};

// ---- v5 の列挙 → 索引のコード桁 (仮置き。ファイル冒頭の注意を参照) ----

const SOJI_DIGIT: Record<Soji, string> = {
  SojiJiki: "1",
  SojiToki: "2",
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
  YuseijoAMushokuTomei: "1",
  YuseijoAYusyokuTomei: "2",
  YuseijoAMFutoumei: "3",
};
const YUSEIJO_B_DIGIT: Record<YuseijoB, string> = {
  YuseijoBKinitsu: "1",
  YuseijoBFukinnitsu: "2",
  YuseijoBLuster: "3",
  YuseijoBKessho: "4",
  YuseijoBKannyu: "5",
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

/** 行の釉名称コードが codes と過不足なく一致するか (どちらもソート済み前提ではなく集合として比較) */
function hasExactCodes(entry: GlazeIndexEntry, codes: string[]): boolean {
  if (entry.g.length !== codes.length) return false;
  for (const code of codes) if (!entry.g.includes(code)) return false;
  return true;
}

export function imageIdOf(n: number): string {
  return String(n).padStart(8, "0");
}

// ---- 問い合わせ ----

/**
 * 現在の条件で、選んだ釉薬 (picks) すべてと同じ行に載っている実データが 1 件以上ある釉名称コードの集合。
 * モーダルでは、ここに無いコードを薄く表示する (選べなくはしない。選ぶと「近いもの」の候補に切り替わる)。
 * picks 自身も含まれる (= 選び直し可能)。
 */
export function availableGlazeCodes(
  index: GlazeIndex,
  cond: GlazeConditions,
  picks: string[]
): Set<string> {
  const pattern = conditionPattern(cond);
  const out = new Set<string>();
  for (const e of index.entries) {
    if (e.g.length === 0) continue;
    if (!matchesPattern(e.c, pattern)) continue;
    if (!hasAllCodes(e, picks)) continue;
    for (const code of e.g) out.add(code);
  }
  return out;
}

export type GlazeCombo = {
  /** 釉名称コード (ソート済み)。この並びがそのまま「組み合わせ」の同一性 */
  codes: string[];
  /** この組み合わせ + 条件の実データ件数 */
  count: number;
  /** 代表色 (#rrggbb)。色の無いデータしか無ければ null */
  hex: string | null;
  /** picks のうち何個を含むか (picks が空なら 0) */
  matched: number;
};

/**
 * 現在の条件で実データがある釉薬の組み合わせを、選んだ釉薬 (picks) に近い順に並べる。
 * - picks をすべて含む組み合わせが先頭 (matched === picks.length)。
 * - その中では余分なコードが少ないもの → 件数が多いもの の順。
 * - picks をすべて含むものが無くても、一部しか含まない組み合わせを matched の多い順に返すので、
 *   呼び出し側は matched で「完全一致」「近いもの」を区別して見せる。
 * picks が空のときは条件に合う全組み合わせを件数順に返す。
 */
export function findGlazeCombos(
  index: GlazeIndex,
  cond: GlazeConditions,
  picks: string[]
): GlazeCombo[] {
  const pattern = conditionPattern(cond);
  const groups = new Map<string, { codes: string[]; count: number; colors: Rgb[] }>();
  for (const e of index.entries) {
    if (e.g.length === 0) continue;
    if (!matchesPattern(e.c, pattern)) continue;
    const key = e.g.join("+");
    let g = groups.get(key);
    if (!g) {
      g = { codes: e.g, count: 0, colors: [] };
      groups.set(key, g);
    }
    g.count += e.i.length;
    if (e.k) for (const raw of e.k) if (raw) g.colors.push(parseHex(`#${raw}`));
  }
  const out: GlazeCombo[] = [];
  for (const g of groups.values()) {
    let matched = 0;
    for (const code of picks) if (g.codes.includes(code)) matched++;
    if (picks.length > 0 && matched === 0) continue;
    out.push({
      codes: g.codes,
      count: g.count,
      hex: g.colors.length > 0 ? toHex(nearestToMean(g.colors)) : null,
      matched,
    });
  }
  out.sort(
    (a, b) =>
      b.matched - a.matched ||
      a.codes.length - b.codes.length ||
      b.count - a.count ||
      a.codes.join("+").localeCompare(b.codes.join("+"))
  );
  return out;
}

/** 条件に合い、釉名称コードが codes と過不足なく一致する実在レシピの一覧 */
export function findGlazeRecipes(
  index: GlazeIndex,
  cond: GlazeConditions,
  codes: string[]
): GlazeRecipeRef[] {
  const pattern = conditionPattern(cond);
  const out: GlazeRecipeRef[] = [];
  for (const e of index.entries) {
    if (!matchesPattern(e.c, pattern)) continue;
    if (!hasExactCodes(e, codes)) continue;
    for (let k = 0; k < e.i.length; k++) {
      const raw = e.k?.[k];
      out.push({
        imageId: imageIdOf(e.i[k]),
        temp: e.t[k],
        codes: e.g,
        hex: raw ? `#${raw}` : null,
      });
    }
  }
  return out;
}

/**
 * 条件と釉薬の組み合わせ (codes) に合う実在レシピを 1 件選ぶ。無ければ null。
 * seed を渡すと同じ候補集合から同じ 1 件が選ばれる (省略時はランダム)。
 */
export function pickGlazeRecipe(
  index: GlazeIndex,
  cond: GlazeConditions,
  codes: string[],
  seed?: number
): GlazeRecipeRef | null {
  const list = findGlazeRecipes(index, cond, codes);
  if (list.length === 0) return null;
  const r = seed === undefined ? Math.random() : seededUnit(seed);
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

/**
 * 条件と釉薬の組み合わせ (codes) に合う実データの代表色 (#rrggbb)。色の無いデータしか無ければ null。
 * 合致する行の色の平均にいちばん近い実在の色を返す (平均そのものは存在しない中間色になりうるため)。
 */
export function representativeGlazeColor(
  index: GlazeIndex,
  cond: GlazeConditions,
  codes: string[]
): string | null {
  const colors = findGlazeRecipes(index, cond, codes)
    .map((r) => r.hex)
    .filter((h): h is string => h !== null)
    .map(parseHex);
  if (colors.length === 0) return null;
  return toHex(nearestToMean(colors));
}

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: Rgb): string {
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 色の平均にいちばん近い実在の色 (colors は 1 件以上) */
function nearestToMean(colors: Rgb[]): Rgb {
  const mean = [0, 1, 2].map((i) => colors.reduce((sum, c) => sum + c[i], 0) / colors.length);
  let best = colors[0];
  let bestDist = Infinity;
  for (const c of colors) {
    const d = (c[0] - mean[0]) ** 2 + (c[1] - mean[1]) ** 2 + (c[2] - mean[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
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
