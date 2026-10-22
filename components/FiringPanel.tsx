"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { additivesForColor, thicknessDesc } from "@/lib/recipe";
import { SEGER_ROWS, type FiringUiState } from "@/lib/firing-request";
import { renderVesselDepthPng } from "@/lib/depth";
import { firingCapabilities } from "@/lib/firing-capabilities";
import { createMockJobClient } from "@/lib/firing-mock";
import {
  initialProgress,
  runFiring,
  type FiringProgress,
  type FiringStage,
} from "@/lib/firing-run";
import {
  DELTA_E_FAR,
  HYOMEN_LABEL,
  SHOSEI_LABEL,
  SOJI_LABEL,
  YUSEIJO_A_LABEL,
  YUSEIJO_B_LABEL,
} from "@/lib/generate_v5";
import { liveJobClient } from "@/lib/job-client";
import type { Strings } from "@/lib/i18n";
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
  thickness: number;
  t: Strings;
  /** 生成中かどうか。次のステップへの遷移を止めるために使う */
  onGeneratingChange: (generating: boolean) => void;
  /** 焼成の進捗 (温度・途中の絵・粒・GLB)。焼き上がった器の表示と演出はこれを見て描く */
  onProgress?: (progress: FiringProgress | null) => void;
};

const SETTLED: FiringStage[] = ["done", "failed", "config"];

export default function FiringPanel({
  active,
  fireKey,
  ui,
  shape,
  custom,
  thickness,
  t,
  onGeneratingChange,
  onProgress,
}: FiringPanelProps) {
  const [progress, setProgress] = useState<FiringProgress>(() => initialProgress());
  const [retryKey, setRetryKey] = useState(0);

  // 生成リクエストは焼成を開始した時点の UI 状態から組む
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const vesselRef = useRef({ shape, custom });
  vesselRef.current = { shape, custom };
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

      // 形 → 深度画像 (フロントで描く)。WebGL が使えない等で失敗したら焼成失敗にする
      let depthPng: string;
      try {
        const { shape, custom } = vesselRef.current;
        depthPng = renderVesselDepthPng(shape, custom);
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

      const result = await runFiring(
        {
          ui: uiRef.current,
          depthPng,
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

  const glaze = ui.glaze;
  const additives = glaze
    ? additivesForColor(glaze.hsl)
    : [{ key: "無添加 (透明釉ベース)", val: "-" }];

  const recipe = progress.recipe ?? result?.recipe ?? null;
  const colorFar =
    recipe?.delta_e_to_color != null && recipe.delta_e_to_color >= DELTA_E_FAR;

  useEffect(() => {
    callbacksRef.current.onGeneratingChange(generating);
  }, [generating]);

  if (!active) return null;

  // 焼成中は全画面の焼成演出になり、進行状況だけを中央に出す
  // (温度・途中の絵・粒の演出は次の項目。ここでは段階名と温度・途中の絵の step を文字で出す)
  if (phase !== "done" && phase !== "failed" && phase !== "config") {
    const stage3d =
      phase === "running3d" && progress.stage3d
        ? t.stages3d[progress.stage3d as keyof typeof t.stages3d] ?? progress.stage3d
        : null;
    return (
      <div className="firing-label" role="status">
        <div className="firing-title">{t.firing}</div>
        <div className="firing-phase">{t.phases[phase]}</div>
        {stage3d && <div className="firing-phase">{stage3d}</div>}
        {recipe && <div className="firing-phase">{recipe.temp}℃</div>}
        {progress.preview && (
          <div className="firing-phase">
            {progress.preview.step} / {progress.preview.steps ?? 30}
          </div>
        )}
      </div>
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

      {/* レシピ本文はデザインに合わせて言語切替に関わらず日本語表記 */}
      <div className="recipe-body">
        {/* v5 が選んだ実在レシピ (産総研 DB)。一般公開しない前提 */}
        {recipe && (
          <div className="recipe-block recipe-block-wide">
            <div className="rb-ttl">選ばれた釉薬</div>
            <div className="recipe-row">
              <span className="key">- 外観</span>
              <span className="val">{recipe.appearance_ja}</span>
            </div>
            <div className="recipe-row">
              <span className="key">- 艶 / 透明度 / 質感</span>
              <span className="val">
                {HYOMEN_LABEL[recipe.hyomen]} / {YUSEIJO_A_LABEL[recipe.yuseijo_a]} /{" "}
                {YUSEIJO_B_LABEL[recipe.yuseijo_b]}
              </span>
            </div>
            {recipe.relaxed.length > 0 && (
              <div className="recipe-row">
                <span className="key">- 外した条件</span>
                <span className="val">{recipe.relaxed.join(", ")}</span>
              </div>
            )}
          </div>
        )}

        <div className="recipe-block">
          <div className="rb-ttl">基礎釉</div>
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
          <div className="rb-ttl">添加物</div>
          {additives.map((a) => (
            <div className="recipe-row" key={a.key}>
              <span className="key">- {a.key}</span>
              <span className="val">{a.val}</span>
            </div>
          ))}
        </div>

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
            <span className="val">{recipe ? recipe.temp : ui.temp}℃</span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成雰囲気</span>
            <span className="val">
              {recipe ? `${SHOSEI_LABEL[recipe.shosei]}焼成` : ui.atmosphere}
            </span>
          </div>
          <div className="recipe-row">
            <span className="key">- 施釉</span>
            <span className="val">{thicknessDesc(thickness)}</span>
          </div>
        </div>
      </div>

      <div className="recipe-note">{t.disclaimer}</div>
    </div>
  );
}
