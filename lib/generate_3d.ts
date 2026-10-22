// KESHIKI 3D API (器の画像 → GLB) の I/O 契約。
// 正本: docs/api/serverless_api_3d.md (2026-10-06 試験稼働版) と
//       docs/api/serverless_api_progress.md 3 (途中の形 `detail`、2026-10-12 試作)。
// v5 とは別 endpoint。proxy には `?api=3d` を付けて投げる (lib/runpod.ts)。
// ⚠ 2026-10-15 時点: 山岸さんの key に 3D endpoint の権限が無く 403。`detail` も本番未反映。

import type { GenerateError, JobStatus } from "./glaze_prompt";

export const GENERATE_3D_QUERY = "?api=3d";

// ---- 入力 ----

export type Quality3D = "standard" | "high";

export type GenerateInput3D = {
  /** 器の画像。v5 の images[0].url (背景つき data URL) をそのまま渡す。深度で切り抜いた透過画像は渡さない */
  image: string;
  quality?: Quality3D; // 既定 standard (1024、1〜2 分)。high は 1536 (2〜4 分、縦の筋が乗ることがある)
  seed?: number; // 既定 42。同じ画像・同じ seed なら同じ 3D
  /** 途中の形 (切り抜き・粒・色付き粒) を途中経過で受け取る。3D 全体が約 10 秒延びる */
  detail?: boolean;
};

// ---- 途中経過 ----

/**
 * 粒 (点群)。xyz は格子の整数座標で **z が上** (TRELLIS の座標)。
 * three.js (y が上) では (x, y, z) → (x, z, -y) に入れ替える。完成 GLB は最初から y が上。
 * 粗い形は 0〜31、細かい形は 0〜63、色付きの点は 0〜1023。
 */
export type Points3D = {
  n_total: number; // 間引く前の点数
  xyz: [number, number, number][];
  rgb?: [number, number, number][]; // 0〜255。color_points にだけ入る
};

/** detail: true のときに IN_PROGRESS の output に入る段階 (届く順) */
export type Stage3D =
  | "loading" // cold のときの読み込み中 (本番反映時に文字列から揃える予定)
  | "ready" // モデル読み込み済み
  | "cutout" // image: 背景を除いた器 (JPEG 384px)
  | "coarse_shape" // res 32、points: 大まかな形
  | "fine_shape" // res 64、points: 細かい形 (最大 6,000 点)
  | "shape_mesh" // faces: 色のない形状の面数 (GLB 本体は完了時の detail.shape_mesh.glb)
  | "texture_latent" // 中身なし (質感の計算が終わった合図)
  | "color_points"; // points (rgb つき、最大 8,000 点)

export type Progress3D = {
  stage: Stage3D | string;
  t?: number; // 3D の worker が job を受け取ってからの秒
  load_sec?: number;
  image?: string; // cutout
  res?: number; // coarse_shape / fine_shape
  points?: Points3D; // coarse_shape / fine_shape / color_points
  faces?: number; // shape_mesh
};

// ---- 出力 ----

export type Detail3D = {
  cutout?: { t: number; image: string };
  coarse_shape?: { t: number; res: number; points: Points3D };
  fine_shape?: { t: number; res: number; points: Points3D };
  shape_mesh?: { t: number; faces: number; glb: string }; // 色のない形状の GLB (data URL)
  texture_latent?: { t: number };
  color_points?: { t: number; points: Points3D };
};

export type GenerateOutput3D = {
  /** glTF バイナリの data URL (テクスチャは WebP)。GLTFLoader でそのまま読める。detail あり時は 5.5MB 以下 */
  glb: string;
  meta?: {
    quality?: Quality3D;
    resolution?: number;
    seed?: number;
    glb_bytes?: number;
    max_faces?: number;
    texture_size?: number;
    gen_sec?: number;
    glb_sec?: number;
    load_sec?: number;
    [key: string]: unknown;
  };
  /** detail: true のときだけ */
  detail?: Detail3D;
  timeline?: { stage: string; t: number }[];
};

export type JobStatusResponse3D = {
  id: string;
  status: JobStatus;
  output?: GenerateOutput3D | Progress3D | GenerateError | { message?: string } | string;
  error?: string;
};

export function isProgress3D(o: unknown): o is Progress3D {
  return typeof o === "object" && o !== null && typeof (o as Progress3D).stage === "string";
}

export function isGenerateOutput3D(o: unknown): o is GenerateOutput3D {
  return typeof o === "object" && o !== null && typeof (o as GenerateOutput3D).glb === "string";
}

export function buildGenerateInput3D(
  image: string,
  options: { quality?: Quality3D; seed?: number; detail?: boolean } = {}
): GenerateInput3D {
  const input: GenerateInput3D = { image, quality: options.quality ?? "standard", seed: options.seed ?? 42 };
  if (options.detail) input.detail = true;
  return input;
}

/**
 * 粒を three.js 用の座標 (y が上、中心 0、最大辺 `extent`) に変換する。
 * 戻り値は position (xyz×n) と color (rgb×n、0〜1。rgb が無ければ fallback 色)
 */
export function pointsToBuffers(
  points: Points3D,
  extent = 1.6,
  fallback: [number, number, number] = [0.9, 0.55, 0.35]
): { position: Float32Array; color: Float32Array } {
  const n = points.xyz.length;
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  if (n === 0) return { position, color };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points.xyz) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < lo[k]) lo[k] = p[k];
      if (p[k] > hi[k]) hi[k] = p[k];
    }
  }
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  const s = extent / Math.max(1, ...hi.map((v, k) => v - lo[k]));
  for (let i = 0; i < n; i++) {
    const p = points.xyz[i];
    // z が上 → y が上
    position[i * 3] = (p[0] - c[0]) * s;
    position[i * 3 + 1] = (p[2] - c[2]) * s;
    position[i * 3 + 2] = -(p[1] - c[1]) * s;
    const rgb = points.rgb?.[i];
    color[i * 3] = rgb ? rgb[0] / 255 : fallback[0];
    color[i * 3 + 1] = rgb ? rgb[1] / 255 : fallback[1];
    color[i * 3 + 2] = rgb ? rgb[2] / 255 : fallback[2];
  }
  return { position, color };
}
