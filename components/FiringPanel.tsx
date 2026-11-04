"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { additivesForColor } from "@/lib/recipe";
import { SEGER_ROWS, type FiringUiState } from "@/lib/firing-request";
import { DEFAULT_CAPTURE_ANGLE, renderVesselDepthPng, type CaptureAngle } from "@/lib/depth";
import { firingCapabilities } from "@/lib/firing-capabilities";
import { createMockJobClient } from "@/lib/firing-mock";
import {
  initialProgress,
  runFiring,
  type FiringProgress,
  type FiringStage,
} from "@/lib/firing-run";
import {
  baseConditionsOf,
  DELTA_E_FAR,
  SHOSEI_LABEL,
  SOJI_LABEL,
  type RecipeV5,
  type SegerV5,
} from "@/lib/generate_v5";
import { loadGlazeIndex, pickGlazeRecipe } from "@/lib/glaze-index";
import { liveJobClient } from "@/lib/job-client";
import type { Strings } from "@/lib/i18n";
import { preloadVesselModel } from "@/lib/vessel-models";
import type { CustomVessel, VesselShape } from "@/lib/vessels";

export type FiringPanelProps = {
  /** Step 3 が表示されているか。非表示中は進行中のジョブをキャンセルする */
  active: boolean;
  /** 「焼成する」を押すたびに増える。値が変わったら新しく焼成する */
  fireKey: number;
  ui: FiringUiState;
  /** 深度画像の元になる器の形 */
  shape: VesselShape;
  custom: CustomVessel | null;
  /** 深度画像を撮る角度 (ヨー・俯角)。省略で既定の正面やや上から */
  captureAngle?: CaptureAngle;
  t: Strings;
  /** 生成中かどうか。次のステップへの遷移を止めるために使う */
  onGeneratingChange: (generating: boolean) => void;
  /** 焼成の進捗 (温度・途中の絵・粒・GLB)。焼き上がった器の表示と演出はこれを見て描く */
  onProgress?: (progress: FiringProgress | null) => void;
};

const SETTLED: FiringStage[] = ["done", "failed", "config"];

// 温度カウンター: 焼成開始から TEMP_RISE_MS かけて 0 → 焼成温度 (DB) まで上がる。
// レシピ (温度) は約 1 秒で届くので、届くまでは FALLBACK_TEMP に向けて上がり始める
const TEMP_RISE_MS = 30_000;
const FALLBACK_TEMP = 1280;

// ゼーゲル式の表示名 (DB の key → 下付き文字)
const SEGER_LABEL: Record<keyof SegerV5, string> = {
  KNaO: "KNaO",
  Li2O: "Li₂O",
  MgO: "MgO",
  CaO: "CaO",
  SrO: "SrO",
  BaO: "BaO",
  ZnO: "ZnO",
  PbO: "PbO",
  Al2O3: "Al₂O₃",
  SiO2: "SiO₂",
  B2O3: "B₂O₃",
};
const SEGER_ORDER = Object.keys(SEGER_LABEL) as (keyof SegerV5)[];

/** 焼成温度のカウンター。毎フレーム再描画しないよう DOM に直接書く */
function TempCounter({ target, startedAt }: { target: number | null; startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const goal = target ?? FALLBACK_TEMP;
    let raf = 0;
    const tick = () => {
      const f = Math.min(1, (Date.now() - startedAt) / TEMP_RISE_MS);
      const eased = 1 - Math.pow(1 - f, 2.2);
      if (ref.current) ref.current.textContent = String(Math.round(goal * eased));
      // 背景は温度と同じ進みで黒 → 赤になる (globals.css .backdrop-firing::after)
      document.documentElement.style.setProperty("--heat", eased.toFixed(3));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.style.removeProperty("--heat");
    };
  }, [target, startedAt]);
  return (
    <div className="firing-temp">
      <span ref={ref}>0</span>°C
    </div>
  );
}

// 進捗: 工程が 1 つ終わるごとに 1 コマ埋まる (時間では伸ばさない)。
// 各コマは「ここまで届いた」の判定。先頭から連続して真のものまでを完了とみなす
const STAGE_ORDER: FiringStage[] = [
  "submitting",
  "queued",
  "running",
  "submitting3d",
  "queued3d",
  "running3d",
  "done",
];
const stageAtLeast = (p: FiringProgress, s: FiringStage) =>
  STAGE_ORDER.indexOf(p.stage) >= STAGE_ORDER.indexOf(s);
const POINTS_ORDER = ["coarse_shape", "fine_shape", "color_points"] as const;
const pointsAtLeast = (p: FiringProgress, s: (typeof POINTS_ORDER)[number]) =>
  p.glb !== null ||
  (p.points !== null && POINTS_ORDER.indexOf(p.points.stage) >= POINTS_ORDER.indexOf(s));

type Checkpoint = (p: FiringProgress) => boolean;
// v5 (絵): 投入 → 窯が動いた → レシピ決定 → 絵ができた
const CHECKPOINTS_2D: Checkpoint[] = [
  (p) => stageAtLeast(p, "queued"),
  (p) => stageAtLeast(p, "running"),
  (p) => p.recipe !== null,
  (p) => p.image !== null || p.output !== null,
];
// 3D: 投入 → 動いた → 切り抜き → 粗い形 → 細かい形 → 色付け → GLB
const CHECKPOINTS_3D: Checkpoint[] = [
  ...CHECKPOINTS_2D,
  (p) => stageAtLeast(p, "queued3d"),
  (p) => stageAtLeast(p, "running3d"),
  (p) => p.cutout !== null || p.points !== null || p.glb !== null,
  (p) => pointsAtLeast(p, "coarse_shape"),
  (p) => pointsAtLeast(p, "fine_shape"),
  (p) => pointsAtLeast(p, "color_points"),
  (p) => p.glb !== null,
];

function FiringSteps({
  progress,
  model3d,
  title,
}: {
  progress: FiringProgress;
  model3d: boolean;
  title: string;
}) {
  const checkpoints = model3d ? CHECKPOINTS_3D : CHECKPOINTS_2D;
  let done = 0;
  while (done < checkpoints.length && checkpoints[done](progress)) done++;
  return (
    <div
      className="firing-steps"
      role="progressbar"
      aria-label={title}
      aria-valuemin={0}
      aria-valuemax={checkpoints.length}
      aria-valuenow={done}
    >
      {checkpoints.map((_, i) => (
        <span
          key={i}
          className={`firing-step ${i < done ? "is-done" : i === done ? "is-now" : ""}`}
        />
      ))}
    </div>
  );
}

/** 生成途中の絵。新しい絵は前の絵の上にフェードインする */
function PreviewFrames({ src, frameKey }: { src: string | null; frameKey: string }) {
  const [layers, setLayers] = useState<{ prev: string | null; cur: string | null; key: string }>({
    prev: null,
    cur: null,
    key: "",
  });
  useEffect(() => {
    setLayers((l) => (l.cur === src ? l : { prev: l.cur, cur: src, key: frameKey }));
  }, [src, frameKey]);
  if (!layers.cur) return null;
  return (
    <div className="firing-preview" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {layers.prev && <img src={layers.prev} alt="" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={layers.key} className="is-in" src={layers.cur} alt="" />
    </div>
  );
}

/** DB の実在レシピ (原料配合・釉名称・ゼーゲル式) */
function DbRecipe({ recipe }: { recipe: RecipeV5 }) {
  const formula = recipe.formula;
  const sections =
    formula?.sections && formula.sections.length > 0
      ? formula.sections
      : formula?.text
        ? [{ label: "原料配合", text: formula.text }]
        : [];
  const seger = recipe.seger
    ? SEGER_ORDER.filter((k) => recipe.seger![k] > 0).map((k) => ({
        label: SEGER_LABEL[k],
        mol: recipe.seger![k],
      }))
    : [];
  return (
    <>
      {recipe.glaze_types.length > 0 && (
        <div className="recipe-block recipe-block-wide">
          <div className="rb-ttl">釉名称</div>
          <div className="recipe-text">
            {recipe.glaze_types.map((g) => g.ja).join("、")}
          </div>
        </div>
      )}
      {sections.length === 0 && (
        <div className="recipe-block recipe-block-wide">
          <div className="rb-ttl">原料配合</div>
          <div className="recipe-text">記載なし</div>
        </div>
      )}
      {sections.map((s) => (
        <div className="recipe-block recipe-block-wide" key={s.label}>
          <div className="rb-ttl">{s.label}</div>
          <div className="recipe-text">{s.text}</div>
        </div>
      ))}
      {seger.length > 0 && (
        <div className="recipe-block recipe-block-wide">
          <div className="rb-ttl">ゼーゲル式</div>
          <div className="recipe-cols">
            {seger.map((row) => (
              <div className="recipe-row" key={row.label}>
                <span className="key">{row.label}</span>
                <span className="val">{row.mol.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** レシピが取れなかったとき (API 未設定・失敗) の概算表示 */
function EstimateRecipe({ ui }: { ui: FiringUiState }) {
  const additives = ui.glaze
    ? additivesForColor(ui.glaze.hsl)
    : [{ key: "無添加 (透明釉ベース)", val: "-" }];
  return (
    <>
      <div className="recipe-block">
        <div className="rb-ttl">基礎釉（概算）</div>
        <div className="recipe-row"><span className="key">- 長石</span><span className="val">40</span></div>
        <div className="recipe-row"><span className="key">- 石灰石</span><span className="val">15</span></div>
        <div className="recipe-row"><span className="key">- 珪石</span><span className="val">25</span></div>
        <div className="recipe-row"><span className="key">- カオリン</span><span className="val">10</span></div>
        <div className="recipe-row"><span className="key">- フリット</span><span className="val">10</span></div>
      </div>
      <div className="recipe-block">
        <div className="rb-ttl">ゼーゲル式（概算）</div>
        {SEGER_ROWS.map((row) => (
          <div className="recipe-row" key={row.idx}>
            <span className="key">{row.label}</span>
            <span className="val">{row.mol.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="recipe-block recipe-block-wide">
        <div className="rb-ttl">添加物（概算）</div>
        {additives.map((a) => (
          <div className="recipe-row" key={a.key}>
            <span className="key">- {a.key}</span>
            <span className="val">{a.val}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function FiringPanel({
  active,
  fireKey,
  ui,
  shape,
  custom,
  captureAngle = DEFAULT_CAPTURE_ANGLE,
  t,
  onGeneratingChange,
  onProgress,
}: FiringPanelProps) {
  const [progress, setProgress] = useState<FiringProgress>(() => initialProgress());
  const [retryKey, setRetryKey] = useState(0);

  // 生成リクエストは焼成を開始した時点の UI 状態から組む
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const vesselRef = useRef({ shape, custom, angle: captureAngle });
  vesselRef.current = { shape, custom, angle: captureAngle };
  const callbacksRef = useRef({ onGeneratingChange, onProgress });
  callbacksRef.current = { onGeneratingChange, onProgress };

  // 焼成の実行単位。同じ runKey で結果が確定済みなら Step 3 に戻ってきても再焼成しない
  const runKey = `${fireKey}:${retryKey}`;
  const settledRunRef = useRef<string | null>(null);
  // 3D だけやり直すときに使う v5 の結果 (同じ fireKey の間だけ有効)
  const resumeRef = useRef<{ fireKey: number; progress: FiringProgress } | null>(null);

  // 本番 (proxy 経由) か疑似応答か。疑似応答は器の形から絵・粒・GLB を作る
  const caps = useMemo(() => firingCapabilities(), []);
  const client = useMemo(
    () =>
      caps.mock
        ? createMockJobClient({ getVessel: () => vesselRef.current, speed: caps.mockSpeed })
        : liveJobClient,
    [caps]
  );

  useEffect(() => {
    if (!active) return;
    if (settledRunRef.current === runKey) return;
    const controller = new AbortController();
    const resume =
      resumeRef.current && resumeRef.current.fireKey === fireKey
        ? resumeRef.current.progress
        : null;
    resumeRef.current = null;

    const publish = (p: FiringProgress) => {
      setProgress(p);
      callbacksRef.current.onProgress?.(p);
    };

    (async () => {
      publish(initialProgress());

      // 形 → 深度画像 (フロントで描く)。WebGL が使えない等で失敗したら焼成失敗にする。
      // GLB の形は先にメッシュを読み込んでおく
      let depthPng: string;
      try {
        const { shape, custom, angle } = vesselRef.current;
        await preloadVesselModel(shape);
        if (controller.signal.aborted) return;
        depthPng = renderVesselDepthPng(shape, custom, { angle });
      } catch (e) {
        settledRunRef.current = runKey;
        publish({
          ...initialProgress(),
          stage: "failed",
          failedAt: "v5",
          error: { error: "depth_render_failed", message: String(e) },
        });
        return;
      }

      // 釉薬から選んだときは、条件と選択した釉名称に合う実在レシピを索引から 1 件選んで焼く。
      // 索引が読めない・見つからないときは条件検索 (buildGlazeV5) に落とす
      const startUi = uiRef.current;
      let recipeId: string | undefined;
      if (startUi.mode === "style" && startUi.glazeCodes.length > 0) {
        try {
          const index = await loadGlazeIndex();
          const picked = pickGlazeRecipe(
            index,
            baseConditionsOf(startUi),
            startUi.glazeCodes,
            fireKey
          );
          if (picked) recipeId = picked.imageId;
        } catch (e) {
          console.error("glaze index load failed", e);
        }
        if (controller.signal.aborted) return;
      } else if (startUi.mode === "mood" && startUi.moodRecipeId) {
        // 感覚でつくる: 自由探索で確定したテストピースの釉で焼く
        recipeId = startUi.moodRecipeId;
      }

      const result = await runFiring(
        {
          ui: startUi,
          depthPng,
          recipeId,
          resume: resume?.output ? { output: resume.output } : undefined,
        },
        {
          client,
          caps,
          signal: controller.signal,
          timeoutMessage: t.fireTimeout,
          onProgress: publish,
        }
      ).catch((e): FiringProgress => ({
        ...initialProgress(),
        stage: "failed",
        failedAt: "v5",
        error: { error: "unexpected", message: String(e) },
      }));
      if (controller.signal.aborted) return;
      if (SETTLED.includes(result.stage)) settledRunRef.current = runKey;
      if (result.stage === "failed" && result.failedAt === "3d" && result.output) {
        resumeRef.current = { fireKey, progress: result };
      }
      publish(result);
    })();

    return () => {
      // 進行中のまま Step 3 を離れたら RunPod 側もキャンセルする (戻ってきたら再焼成)
      controller.abort();
    };
  }, [active, runKey, fireKey, client, caps, t.fireTimeout]);

  const phase = progress.stage;
  const error = progress.error;
  const result = progress.output;
  const generating = !SETTLED.includes(phase);
  const canRetry3d = phase === "failed" && progress.failedAt === "3d" && !!progress.output;

  const recipe = progress.recipe ?? result?.recipe ?? null;
  const colorFar =
    recipe?.delta_e_to_color != null && recipe.delta_e_to_color >= DELTA_E_FAR;

  useEffect(() => {
    callbacksRef.current.onGeneratingChange(generating);
  }, [generating]);

  if (!active) return null;

  // 焼成中は全画面の焼成演出になり、温度と進捗バー、生成途中の絵を出す
  if (phase !== "done" && phase !== "failed" && phase !== "config") {
    // 粒が届いたら粒 (VesselCanvas) を見せるので、絵は粒が届くまで
    const frame = progress.points ? null : progress.preview?.image ?? progress.image ?? null;
    const frameKey = progress.preview ? `step:${progress.preview.step}` : "final";
    return (
      <>
        <PreviewFrames src={frame} frameKey={frameKey} />
        <div className="firing-label" role="status">
          <div className="firing-title">{t.firing}</div>
          <TempCounter target={recipe?.temp ?? null} startedAt={progress.startedAt} />
          <FiringSteps progress={progress} model3d={caps.model3d} title={t.phases[phase]} />
        </div>
      </>
    );
  }

  return (
    <div className="recipe">
      <div className="recipe-title">{t.suggestedRecipe}</div>

      {(phase === "failed" || phase === "config") && (
        <div className="recipe-notice">
          <div className="recipe-notice-title">
            {phase === "config"
              ? t.fireConfig
              : `${t.fireFailed}${error ? `: ${error.error}` : ""}`}
          </div>
          {phase === "failed" && error?.message && (
            <div className="recipe-notice-message">{error.message}</div>
          )}
          {phase === "failed" && (
            <button
              type="button"
              className="link"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              {canRetry3d ? t.retry3d : t.retry}
            </button>
          )}
        </div>
      )}

      {colorFar && (
        <div className="recipe-notice">
          <div className="recipe-notice-message">{t.colorFar}</div>
        </div>
      )}

      {/* レシピ本文はデザインに合わせて言語切替に関わらず日本語表記。中身は DB の実在レシピ */}
      <div className="recipe-body">
        {recipe ? <DbRecipe recipe={recipe} /> : <EstimateRecipe ui={ui} />}

        <div className="recipe-block recipe-block-wide">
          <div className="rb-ttl">焼成条件</div>
          <div className="recipe-row">
            <span className="key">- 素地</span>
            <span className="val">
              {recipe ? SOJI_LABEL[recipe.soji] : ui.clay}
            </span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成温度</span>
            <span className="val">{recipe ? recipe.temp : ui.temp}°C</span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成雰囲気</span>
            <span className="val">
              {recipe ? `${SHOSEI_LABEL[recipe.shosei]}焼成` : ui.atmosphere}
            </span>
          </div>
        </div>
      </div>

      <div className="recipe-note">{t.disclaimer}</div>
    </div>
  );
}
