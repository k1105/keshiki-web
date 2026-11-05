// v5 の絵 (生成途中の絵と焼き上がりの絵。背景つきの RGB で、アルファは無い) を、
// フロントで描いた深度画像で切り抜いて背景を透過にする。
//
// v5 の絵は送った深度画像と同じ構図 (同じ正方形の枠) で返るので、深度 > 0 の画素を器とみなす。
// ただし生成された器の輪郭は深度の輪郭から数 px〜十数 px ずれることがある
// (docs/api/depth_input_spec.md 5)。縁に背景が細く残らないよう、マスクを内側に寄せてぼかす。

// 深度がこの値 (0-255) を超える画素を器とみなす。器のいちばん奥でも 64 前後あり (lib/depth.ts DEPTH_FAR_LEVEL)、
// 輪郭のアンチエイリアスの半分より内側を拾う
const DEPTH_THRESHOLD = 32;
// 縁をぼかす半径 (1024px の絵での px)。大きいほど縁の背景が消えるが、器の縁と細い部分も削れる
const EDGE_PX = 5;
// ぼかしたマスク (0-1、深度の輪郭の上で 0.5) をアルファにする範囲。
// EDGE_LO で透明、EDGE_HI で不透明。0.5 より上から始めるので輪郭は内側に寄る
const EDGE_LO = 0.5;
const EDGE_HI = 0.9;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** 半径 r の箱ぼかし (横 → 縦)。枠の外は端の値が続くものとして扱う (枠に接する器を削らない) */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  const n = 2 * r + 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * depthPng (data URL。背景 = 0) をマスクにして絵の背景を抜く関数を作る。1 回の焼成で 1 つ作り、
 * 途中の絵 (384px) と焼き上がりの絵 (1024px) の両方に使う。
 *
 * 返る関数は image (data URL) の背景を透過にした PNG (data URL) を返す。出力の大きさは image と同じ。
 * 深度画像の読み込みと、絵の大きさごとのアルファ (0-255) は使い回す。
 */
export function createDepthCutter(depthPng: string): (image: string) => Promise<string> {
  let depth: Promise<HTMLImageElement> | null = null;
  const alphaBySize = new Map<string, Uint8ClampedArray>();

  return async (image) => {
    depth ??= loadImage(depthPng);
    const [img, depthImg] = await Promise.all([loadImage(image), depth]);
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("2d context unavailable");

      const key = `${w}x${h}`;
      let alpha = alphaBySize.get(key);
      if (!alpha) {
        // 深度 → 器のマスク (1 = 器、0 = 背景) → 縁をぼかして内側に寄せる
        ctx.drawImage(depthImg, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const mask = new Float32Array(w * h);
        for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4] > DEPTH_THRESHOLD ? 1 : 0;
        const soft = boxBlur(mask, w, h, Math.round((EDGE_PX * w) / 1024));
        alpha = new Uint8ClampedArray(w * h);
        for (let i = 0; i < soft.length; i++) {
          const f = Math.min(1, Math.max(0, (soft[i] - EDGE_LO) / (EDGE_HI - EDGE_LO)));
          alpha[i] = Math.round(255 * f * f * (3 - 2 * f));
        }
        alphaBySize.set(key, alpha);
        ctx.clearRect(0, 0, w, h);
      }

      // 絵のアルファをマスクで置き換える
      ctx.drawImage(img, 0, 0, w, h);
      const out = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < alpha.length; i++) out.data[i * 4 + 3] = alpha[i];
      ctx.putImageData(out, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      // 描画バッファをすぐ手放す (長時間稼働対策)
      canvas.width = canvas.height = 0;
    }
  };
}
