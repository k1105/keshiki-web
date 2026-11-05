// 焼成フローの状態機械: v5 (深度画像 → 器の画像) → 3D (画像 → GLB) を 1 本につなぐ。
//
// 正本: docs/api/serverless_api_v5.md / serverless_api_3d.md / serverless_api_progress.md 4「フロントでの受け取り方」。
// - /status は 1 秒ごとに見る (途中経過は上書きで最後の 1 件しか見えないため)
// - v5 の途中経過: recipe (約 1 秒で届く。焼成温度の目標) と preview (同じ step は 1 回だけ。
//   finishImage で背景を抜いてから進捗に入れる)
// - v5 完了: images[0].url をそのまま 3D に渡す (切り抜かない)
// - 3D の途中経過: stage ごとに cutout / points / faces を保持する
// - 3D 完了: glb (と detail があれば色のない形状の glb)
// - caps.model3d が false のときは 3D を呼ばず、v5 の絵を仕上げて (finishImage: 背景の切り抜き)
//   firedImage に入れ、done にする (glb は null のまま)。焼き上がりは firedImage を見せる
// 画面の演出 (温度カウンター・粒の描画など) はこの進捗 (FiringProgress) を見て描く。ここでは描かない。

import type { FiringCapabilities } from "./firing-capabilities";
import type { FiringUiState } from "./firing-request";
import {
  buildGenerateInput3D,
  isGenerateOutput3D,
  isProgress3D,
  type GenerateOutput3D,
  type Points3D,
  type Stage3D,
} from "./generate_3d";
import {
  buildGenerateInputV5,
  DEFAULT_PREVIEW_V5,
  isGenerateOutputV5,
  isProgressV5,
  type GenerateOutputV5,
  type PreviewFrameV5,
  type RecipeV5,
} from "./generate_v5";
import { isGenerateError, type GenerateError } from "./glaze_prompt";
import type { JobApi, JobClient, JobStatusAny } from "./job-client";

export type FiringStage =
  | "submitting" // v5 に投入中
  | "queued" // v5 の順番待ち (IN_QUEUE)
  | "running" // v5 が生成中 (recipe → preview が届く)
  | "submitting3d" // v5 完了。3D に投入中
  | "queued3d" // 3D の順番待ち
  | "running3d" // 3D が計算中 (stage3d が進む)
  | "done"
  | "failed"
  | "config"; // endpoint 未設定 (503)

export type PointsStage = Extract<Stage3D, "coarse_shape" | "fine_shape" | "color_points">;

export type FiringProgress = {
  stage: FiringStage;
  /** 3D の途中経過の段階名 (running3d 中)。本番未反映のうちは null のまま */
  stage3d: Stage3D | string | null;
  /** 焼成ボタンを押した時刻 (ms) */
  startedAt: number;
  // ---- v5 ----
  /** 選ばれたレシピ。生成より先 (約 1 秒) に届く。temp を温度演出の目標にする */
  recipe: RecipeV5 | null;
  /** 最新の生成途中の絵 (preview 対応時のみ)。finishImage があれば背景を抜いた PNG */
  preview: PreviewFrameV5 | null;
  /** 受け取った途中の絵の step (重複排除用) */
  previewSteps: number[];
  /** 完成した器の画像 (data URL) */
  image: string | null;
  output: GenerateOutputV5 | null;
  /** 焼き上がりとして見せる絵 (3D を作らないときだけ)。image の背景を抜いた PNG。抜けなかったら image と同じ */
  firedImage: string | null;
  // ---- 3D ----
  cutout: string | null;
  /** 最新の粒 (粗い → 細かい → 色付き の順で置き換わる) */
  points: { stage: PointsStage; res?: number; points: Points3D } | null;
  faces: number | null;
  glb: string | null;
  /** 色のない形状の GLB (detail 対応時のみ) */
  shapeGlb: string | null;
  output3d: GenerateOutput3D | null;
  // ---- 失敗 ----
  error: GenerateError | null;
  /** どちらで失敗したか。"3d" なら v5 の結果は残っているので 3D だけやり直せる */
  failedAt: JobApi | null;
};

export type FiringRequest = {
  ui: FiringUiState;
  depthPng: string;
  /** 実在レシピで焼く (Step-2B / 2C)。省略時は ui の条件から v5 が選ぶ */
  recipeId?: string;
  /** 3D だけやり直す: 前回の v5 の結果を使い、v5 は呼ばない */
  resume?: { output: GenerateOutputV5 };
};

export type RunFiringOptions = {
  client: JobClient;
  caps: FiringCapabilities;
  onProgress: (p: FiringProgress) => void;
  /** 中断 (Step 3 を離れた等)。進行中のジョブは RunPod 側もキャンセルする */
  signal: AbortSignal;
  /** ポーリング上限を超えたときのメッセージ */
  timeoutMessage: string;
  /**
   * 絵の仕上げ (背景の切り抜き)。生成途中の絵と、3D を作らないときの焼き上がりの絵に使う。
   * 省略時・失敗時は v5 の絵をそのまま使う
   */
  finishImage?: (image: string) => Promise<string>;
};

export const POLL_MS = 1000; // progress 仕様書: 途中経過は上書きなので 1 秒間隔
// v5: GPU 確保待ちを取りこぼさないよう 15 分。3D: 確保待ちが十数分になることがあるので同じく 15 分
export const POLL_LIMIT_MS = 15 * 60 * 1000;

export function initialProgress(startedAt = Date.now()): FiringProgress {
  return {
    stage: "submitting",
    stage3d: null,
    startedAt,
    recipe: null,
    preview: null,
    previewSteps: [],
    image: null,
    output: null,
    firedImage: null,
    cutout: null,
    points: null,
    faces: null,
    glb: null,
    shapeGlb: null,
    output3d: null,
    error: null,
    failedAt: null,
  };
}

class AbortedError extends Error {
  constructor() {
    super("firing aborted");
    this.name = "AbortedError";
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** FAILED / CANCELLED / TIMED_OUT の失敗理由。ワーカー起因は output.message、RunPod 起因は error */
function jobError(data: JobStatusAny): GenerateError {
  const output = data.output as { message?: string } | undefined;
  return {
    error: data.error ?? data.status,
    message: typeof output?.message === "string" ? output.message : undefined,
  };
}

type PollHandlers = {
  onQueued: () => void;
  onProgress: (output: unknown) => void;
};

/**
 * 1 つのジョブを投入して完了まで見守る。戻り値は COMPLETED の output。
 * 失敗は { failure } で返す (throw は中断のときだけ)。
 */
async function runJob(
  api: JobApi,
  input: unknown,
  opts: RunFiringOptions,
  handlers: PollHandlers
): Promise<
  | { output: unknown }
  | { failure: GenerateError; config?: boolean }
> {
  const { client, signal } = opts;
  const submitted = await client.submit(api, input, signal);
  if (signal.aborted) throw new AbortedError();
  if (!submitted.ok) {
    return { failure: submitted.error, config: submitted.status === 503 };
  }
  const id = submitted.id;
  const startedAt = Date.now();
  handlers.onQueued();

  try {
    for (;;) {
      await sleep(POLL_MS, signal);
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        client.cancel(api, id);
        return { failure: { error: "client_timeout", message: opts.timeoutMessage } };
      }
      const res = await client.status(api, id, signal);
      if (signal.aborted) throw new AbortedError();
      if (!res.ok) {
        // proxy / ネットワークの一時的な失敗は次のポーリングに任せる (上限は startedAt で見る)
        if (res.status === 0 || res.status >= 500) continue;
        client.cancel(api, id);
        return { failure: res.error };
      }
      const data = res.data;
      switch (data.status) {
        case "IN_QUEUE":
          handlers.onQueued();
          break;
        case "IN_PROGRESS":
        case "RUNNING":
          handlers.onProgress(data.output);
          break;
        case "COMPLETED": {
          const output = data.output;
          if (!output || typeof output === "string") {
            return { failure: { error: "empty_output", message: "出力が空でした" } };
          }
          if (isGenerateError(output)) return { failure: output };
          return { output };
        }
        case "CANCELLED":
        case "FAILED":
        case "TIMED_OUT":
          return { failure: jobError(data) };
      }
    }
  } catch (e) {
    // 中断されたら RunPod 側のジョブも止める (戻ってきたら焼き直す)
    if (signal.aborted) client.cancel(api, id);
    throw e;
  }
}

/**
 * 焼成を 1 回走らせる。進捗は onProgress に都度渡し、最後の進捗を返す。
 * 中断 (signal) されたときは最後の進捗をそのまま返す (stage は途中のまま)。
 */
export async function runFiring(
  req: FiringRequest,
  opts: RunFiringOptions
): Promise<FiringProgress> {
  let p = initialProgress();
  const update = (patch: Partial<FiringProgress>) => {
    p = { ...p, ...patch };
    if (!opts.signal.aborted) opts.onProgress(p);
  };
  const fail = (failedAt: JobApi, error: GenerateError, config = false) => {
    update({ stage: config ? "config" : "failed", error, failedAt });
    return p;
  };

  try {
    // ---- v5: 深度画像 → 器の画像 ----
    let output = req.resume?.output ?? null;
    if (output) {
      update({ recipe: output.recipe, image: output.images[0]?.url ?? null, output });
    } else {
      const input = buildGenerateInputV5(req.ui, { depth_png: req.depthPng }, {
        recipeId: req.recipeId,
        preview: opts.caps.preview ? DEFAULT_PREVIEW_V5 : undefined,
      });
      update({ stage: "submitting" });
      const r = await runJob("v5", input, opts, {
        onQueued: () => update({ stage: "queued" }),
        onProgress: (o) => {
          const patch: Partial<FiringProgress> = { stage: "running" };
          if (isProgressV5(o)) {
            if (o.recipe) patch.recipe = o.recipe;
            // 途中の絵は上書きで届くので、同じ step は 1 回だけ扱う
            if (o.preview && !p.previewSteps.includes(o.preview.step)) {
              const frame = o.preview;
              patch.previewSteps = [...p.previewSteps, frame.step];
              if (opts.finishImage) {
                // 途中の絵も背景を抜いてから出す (抜けなかったらそのまま)。
                // 抜き終わる前に生成が終わったか、先の step の絵が出ていたら捨てる
                opts
                  .finishImage(frame.image)
                  .catch(() => frame.image)
                  .then((image) => {
                    if (p.stage !== "running") return;
                    if (p.preview && p.preview.step >= frame.step) return;
                    update({ preview: { ...frame, image } });
                  });
              } else {
                patch.preview = frame;
              }
            }
          }
          update(patch);
        },
      });
      if ("failure" in r) return fail("v5", r.failure, r.config);
      if (!isGenerateOutputV5(r.output) || r.output.images.length === 0) {
        return fail("v5", { error: "empty_output", message: "画像が返されませんでした" });
      }
      output = r.output;
      // 3D を作らないときは、絵は仕上げが済んでから done と一緒に出す (背景つきの絵を一瞬見せない)
      if (opts.caps.model3d) {
        update({ recipe: output.recipe, image: output.images[0].url, output });
      }
    }

    // ---- 3D: 器の画像 → GLB ----
    // 一時無効化中 (lib/firing-capabilities.ts model3d)。v5 の絵 (背景を抜いたもの) で焼き上がりにする
    if (!opts.caps.model3d) {
      const image = output.images[0].url;
      let firedImage = image;
      if (opts.finishImage) {
        try {
          firedImage = await opts.finishImage(image);
        } catch (e) {
          console.error("finishImage failed", e);
        }
        if (opts.signal.aborted) throw new AbortedError();
      }
      update({ stage: "done", recipe: output.recipe, image, output, firedImage });
      return p;
    }
    // v5 の画像 (背景つき) をそのまま渡す。深度で切り抜いた透過画像は渡さない
    const input3d = buildGenerateInput3D(output.images[0].url, {
      detail: opts.caps.detail,
    });
    update({ stage: "submitting3d" });
    const r3 = await runJob("3d", input3d, opts, {
      onQueued: () => update({ stage: "queued3d" }),
      onProgress: (o) => {
        const patch: Partial<FiringProgress> = { stage: "running3d" };
        if (isProgress3D(o)) {
          patch.stage3d = o.stage;
          if (o.stage === "cutout" && o.image) patch.cutout = o.image;
          if (
            (o.stage === "coarse_shape" || o.stage === "fine_shape" || o.stage === "color_points") &&
            o.points
          ) {
            patch.points = { stage: o.stage, res: o.res, points: o.points };
          }
          if (o.stage === "shape_mesh" && typeof o.faces === "number") patch.faces = o.faces;
        }
        update(patch);
      },
    });
    if ("failure" in r3) return fail("3d", r3.failure, r3.config);
    if (!isGenerateOutput3D(r3.output)) {
      return fail("3d", { error: "empty_output", message: "GLB が返されませんでした" });
    }
    const out3d = r3.output;
    const d = out3d.detail;
    update({
      stage: "done",
      stage3d: null,
      glb: out3d.glb,
      shapeGlb: d?.shape_mesh?.glb ?? null,
      // 途中経過を取りこぼしていても、完了時の detail で埋める
      cutout: p.cutout ?? d?.cutout?.image ?? null,
      points:
        p.points ??
        (d?.color_points
          ? { stage: "color_points", points: d.color_points.points }
          : null),
      faces: p.faces ?? d?.shape_mesh?.faces ?? null,
      output3d: out3d,
    });
    return p;
  } catch (e) {
    if (e instanceof AbortedError || opts.signal.aborted) return p;
    throw e;
  }
}
