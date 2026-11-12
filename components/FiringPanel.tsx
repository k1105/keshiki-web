"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FiringUiState } from "@/lib/firing-request";
import { createDepthCutter } from "@/lib/cutout";
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
import { glazeStyleByCode } from "@/lib/glaze-styles";
import { liveJobClient } from "@/lib/job-client";
import { STRINGS, type Strings } from "@/lib/i18n";
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
  /** 失敗のモーダルで「戻る」を押した (Step 2 に戻して選び直せるようにする) */
  onBack: () => void;
};

const SETTLED: FiringStage[] = ["done", "failed", "config"];

// 温度カウンター: 焼成開始から TEMP_RISE_MS かけて 0 → 焼成温度 (DB) まで上がる。
// 釉薬から選ぶ / 感覚でつくる は焼くレシピが先に決まっているので、最初からその温度を目標にする。
// 外観を選ぶ はレシピが届くまで目標が分からない (窯の順番待ちが長いと 30 秒を超える) ので、
// 届くまでは PROVISIONAL_TEMP に向けて上げ、届いたら本来の温度に向かう。
// 仮の目標は DB のほとんどのレシピより低くしておく (1280℃ を仮の目標にしていたときは、
// 1060℃ のレシピでも一度 1280℃ まで表示されてしまった)
const TEMP_RISE_MS = 30_000;
const PROVISIONAL_TEMP = 1000;

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
    const goal = target ?? PROVISIONAL_TEMP;
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

// 結果画面の「選択した条件」。まわりのレシピ本文と同じく日本語表記で固定する
const MODE_LABEL: Record<FiringUiState["mode"], string> = {
  visual: STRINGS.ja.appearance,
  style: STRINGS.ja.glazeHeading,
  mood: STRINGS.ja.inspiration,
};
// v5 が条件を外したとき (recipe.relaxed) のキー → 表示名
const RELAXED_LABEL: Record<string, string> = {
  hyomen: "表面",
  yuseijo_a: "透明度",
  yuseijo_b: "質感",
  soji: "素地",
  shosei: "焼成雰囲気",
};

function shapeLabel(shape: VesselShape): string {
  const shapes = STRINGS.ja.shapes as Record<string, string>;
  return shape === "custom" ? shapes.wheel : (shapes[shape] ?? shape);
}

/** 自分が選んだ条件・入力した言葉 (焼き上がったレシピと見比べられるようにする) */
function SelectedConditions({
  ui,
  shape,
  relaxed,
}: {
  ui: FiringUiState;
  shape: VesselShape;
  relaxed: string[];
}) {
  const glazeNames = ui.glazeCodes.map((code) => glazeStyleByCode(code)?.ja ?? code).join("、");
  return (
    <div className="recipe-block recipe-block-wide">
      <div className="rb-ttl">選択した条件</div>
      <div className="recipe-row">
        <span className="key">- かたち</span>
        <span className="val">{shapeLabel(shape)}</span>
      </div>
      <div className="recipe-row">
        <span className="key">- 選び方</span>
        <span className="val">{MODE_LABEL[ui.mode]}</span>
      </div>
      {ui.mode === "visual" && (
        <>
          {ui.glaze && (
            <div className="recipe-row">
              <span className="key">- 色</span>
              <span className="val">
                <span className="glaze-combo-swatch" style={{ background: ui.glaze.hex }} />
                {ui.glaze.hex}
              </span>
            </div>
          )}
        </>
      )}
      {ui.mode === "style" && (
        <div className="recipe-row">
          <span className="key">- 釉薬</span>
          <span className="val">{glazeNames || "-"}</span>
        </div>
      )}
      {ui.mode === "mood" && (
        <div className="recipe-row">
          <span className="key">- 言葉</span>
          <span className="val recipe-words">{ui.mood.trim() || "-"}</span>
        </div>
      )}
      {relaxed.length > 0 && (
        <div className="recipe-text">
          ※ 一致するデータが無かったため、次の条件は外して選んでいます:{" "}
          {relaxed.map((k) => RELAXED_LABEL[k] ?? k).join("、")}
        </div>
      )}
    </div>
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
  onBack,
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

      // 釉薬から選んだときは、条件と選択した釉名称に合う実在レシピで焼く。
      // 組み合わせの確定時に API 側の索引にあると確かめたレシピ (glazeRecipeId) があればそれを使い、
      // 無ければ索引から 1 件選ぶ。索引が読めない・見つからないときは条件検索 (buildGlazeV5) に落とす
      const startUi = uiRef.current;
      let recipeId: string | undefined;
      if (startUi.mode === "style" && startUi.glazeRecipeId) {
        recipeId = startUi.glazeRecipeId;
      } else if (startUi.mode === "style" && startUi.glazeCodes.length > 0) {
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
          unavailableMessage: t.serverUnavailable,
          onProgress: publish,
          // 途中の絵も焼き上がりの絵も、送った深度画像で背景を抜いてから見せる
          finishImage: createDepthCutter(depthPng),
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
          <TempCounter
            target={recipe?.temp ?? uiRef.current.recipeTemp ?? null}
            startedAt={progress.startedAt}
          />
          <FiringSteps progress={progress} model3d={caps.model3d} title={t.phases[phase]} />
          {/* 今どの段階で待っているか (窯の順番待ちは数分かかることがあり、無表示だと止まって見える) */}
          <div className="firing-phase">{t.phases[phase]}</div>
        </div>
      </>
    );
  }

  // 失敗・API 未設定: 焼き上がりの画面 (器のビューとレシピ) には進まず、画面中央のモーダルで知らせる。
  // 「もう一度焼成する」でやり直すか、「戻る」で Step 2 に戻って選び直す
  if (phase === "failed" || phase === "config") {
    const title = phase === "config" ? t.fireConfig : t.fireFailed;
    return (
      <div className="modal-backdrop">
        <div className="error-modal" role="alertdialog" aria-modal="true" aria-label={title}>
          <div className="error-modal-title">{title}</div>
          {phase === "failed" && error && (
            <div className="error-modal-message">
              {error.error}
              {error.message ? `\n${error.message}` : ""}
            </div>
          )}
          <div className="error-modal-foot">
            <button type="button" className="link" onClick={onBack}>
              {t.back}
            </button>
            {phase === "failed" && (
              <button type="button" className="link" onClick={() => setRetryKey((k) => k + 1)}>
                {canRetry3d ? t.retry3d : t.retry}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="recipe">
      <div className="recipe-title">{t.suggestedRecipe}</div>

      {colorFar && (
        <div className="recipe-notice">
          <div className="recipe-notice-message">{t.colorFar}</div>
        </div>
      )}

      {/* レシピ本文はデザインに合わせて言語切替に関わらず日本語表記。中身は DB の実在レシピ */}
      <div className="recipe-body">
        {recipe && <DbRecipe recipe={recipe} />}

        <div className="recipe-block recipe-block-wide">
          <div className="rb-ttl">焼成条件</div>
          <div className="recipe-row">
            <span className="key">- 素地</span>
            <span className="val">
              {recipe ? SOJI_LABEL[recipe.soji] : (ui.clay ?? "-")}
            </span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成温度</span>
            <span className="val">{recipe ? `${recipe.temp}°C` : "-"}</span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成雰囲気</span>
            <span className="val">
              {recipe ? `${SHOSEI_LABEL[recipe.shosei]}焼成` : (ui.atmosphere ?? "-")}
            </span>
          </div>
        </div>

        <SelectedConditions ui={ui} shape={shape} relaxed={recipe?.relaxed ?? []} />
      </div>

      <div className="recipe-note">{t.disclaimer}</div>
    </div>
  );
}
