"use client";

import { useEffect, useRef, useState } from "react";
import VesselCanvas from "./VesselCanvas";
import { additivesForColor, thicknessDesc } from "@/lib/recipe";
import {
  buildGenerateInput,
  SEGER_ROWS,
  type FiringUiState,
} from "@/lib/firing-request";
import {
  isGenerateError,
  type GenerateError,
  type GenerateOutput,
  type JobStatusResponse,
  type JobSubmitResponse,
} from "@/lib/glaze_prompt";
import type { CustomVessel, VesselShape } from "@/lib/vessels";

export type FiringPanelProps = {
  /** Step 3 が表示されているか。非表示中は進行中のジョブをキャンセルする */
  active: boolean;
  /** 「焼成する」を押すたびに増える。値が変わったら新しく焼成する */
  fireKey: number;
  shape: VesselShape;
  custom?: CustomVessel | null;
  ui: FiringUiState;
  thickness: number;
  gloss: number;
  tone: number;
  /** 焼き上がった生成テクスチャ (選択中の画像)。未生成・生成前は null */
  onTexture: (url: string | null) => void;
  /** 生成中かどうか。次のステップへの遷移を止めるために使う */
  onGeneratingChange: (generating: boolean) => void;
};

// 生成の進行状態。config は本番 API 未設定 (テストピース表示のまま案内を出す)
type Phase =
  | "submitting"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "config";

const POLL_MS = 2000; // ガイドの推奨: 1〜2 秒間隔でポーリング

const PHASE_LABELS: Record<Phase, string> = {
  submitting: "焼成ジョブを投入中…",
  // cold start (窯の新規立ち上げ) は 2.5 分程度かかる
  queued: "窯の順番待ち (IN_QUEUE)… 窯が冷えていると 2〜3 分かかります",
  running: "焼成中 (IN_PROGRESS)… 目安 15 秒前後",
  done: "焼き上がりました",
  failed: "焼成に失敗しました",
  config: "本番生成 API が未設定です",
};

export default function FiringPanel({
  active,
  fireKey,
  shape,
  custom = null,
  ui,
  thickness,
  gloss,
  tone,
  onTexture,
  onGeneratingChange,
}: FiringPanelProps) {
  const [phase, setPhase] = useState<Phase>("submitting");
  const [error, setError] = useState<GenerateError | null>(null);
  const [result, setResult] = useState<GenerateOutput | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  // 生成リクエストは焼成を開始した時点の UI 状態から組む
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const callbacksRef = useRef({ onTexture, onGeneratingChange });
  callbacksRef.current = { onTexture, onGeneratingChange };

  // 焼成の実行単位。同じ runKey で結果が確定済みなら Step 3 に戻ってきても再焼成しない
  const runKey = `${fireKey}:${retryKey}`;
  const settledRunRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (settledRunRef.current === runKey) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let jobId: string | null = null;
    let settled = false;
    const markSettled = () => {
      settled = true;
      settledRunRef.current = runKey;
    };

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const fail = (err: GenerateError, ph: Phase = "failed") => {
      if (disposed) return;
      markSettled();
      setError(err);
      setPhase(ph);
    };

    const cancelJob = (id: string) => {
      fetch(`/api/generate/${id}`, { method: "DELETE" }).catch(() => {});
    };

    const poll = async () => {
      if (!jobId || settled) return;
      try {
        const res = await fetch(`/api/generate/${jobId}`);
        const data: JobStatusResponse & GenerateError = await res.json();
        if (disposed || settled) return;
        if (!res.ok) {
          stopPolling();
          fail(data);
          return;
        }
        switch (data.status) {
          case "IN_QUEUE":
            setPhase("queued");
            break;
          case "IN_PROGRESS":
          case "RUNNING":
            setPhase("running");
            break;
          case "COMPLETED": {
            stopPolling();
            const output = data.output;
            if (!output || isGenerateError(output)) {
              fail(output ?? { error: "empty_output", message: "出力が空でした" });
            } else if (!("images" in output) || output.images.length === 0) {
              fail({ error: "empty_output", message: "画像が返されませんでした" });
            } else {
              markSettled();
              setResult(output);
              setSelectedImage(0);
              setPhase("done");
            }
            break;
          }
          case "CANCELLED":
          case "FAILED":
          case "TIMED_OUT": {
            stopPolling();
            // 失敗理由: ワーカー起因は output.message、RunPod 起因 (timeout 等) は error に入る
            const output = data.output as { message?: string } | undefined;
            fail({
              error: data.status,
              message:
                (typeof output?.message === "string"
                  ? output.message
                  : undefined) ?? data.error,
            });
            break;
          }
        }
      } catch {
        // 一時的なネットワーク断は次のポーリングに任せる
      }
    };

    (async () => {
      setPhase("submitting");
      setError(null);
      setResult(null);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildGenerateInput(uiRef.current)),
        });
        const data: JobSubmitResponse & GenerateError = await res.json();
        if (disposed) {
          if (data?.id) cancelJob(data.id);
          return;
        }
        if (res.status === 503) {
          fail(data, "config");
          return;
        }
        if (!res.ok || !data.id) {
          fail(data ?? { error: "pod_api_unreachable" });
          return;
        }
        jobId = data.id;
        setPhase("queued");
        void poll();
        timer = setInterval(poll, POLL_MS);
      } catch (e) {
        fail({ error: "pod_api_unreachable", message: String(e) });
      }
    })();

    return () => {
      disposed = true;
      stopPolling();
      // 進行中のまま Step 3 を離れたら RunPod 側もキャンセルする (戻ってきたら再焼成)
      if (jobId && !settled) cancelJob(jobId);
    };
  }, [active, runKey]);

  const glaze = ui.glaze;
  const additives = glaze
    ? additivesForColor(glaze.hsl)
    : [{ key: "無添加 (透明釉ベース)", val: "-" }];

  const generating =
    phase === "submitting" || phase === "queued" || phase === "running";
  const currentImage = result?.images[selectedImage] ?? null;
  const textureUrl = currentImage?.url ?? null;

  // 焼き上がったら生成テクスチャをサイドバーのプレビューへ反映する
  useEffect(() => {
    callbacksRef.current.onTexture(textureUrl);
  }, [textureUrl]);
  useEffect(() => {
    callbacksRef.current.onGeneratingChange(generating);
  }, [generating]);

  const isError = phase === "failed" || phase === "config";
  const heroState = generating
    ? "is-generating"
    : phase === "done"
      ? "is-done"
      : "is-error";

  return (
    <>
      {/* 焼成結果が主役: 全幅の大きな器に生成テクスチャをディゾルブで載せる */}
      <div className={`firing-hero ${heroState}`}>
        {active && (
          <VesselCanvas
            shape={shape}
            custom={custom}
            texturePath={textureUrl}
            hex={glaze?.hex ?? null}
            dissolveKey={`fired:${textureUrl ?? "none"}`}
            gloss={gloss}
            tone={tone}
          />
        )}
        <div
          className={`firing-status ${isError ? "is-error" : ""} ${phase === "done" ? "is-done" : ""}`}
        >
          {generating && <span className="firing-spinner" />}
          {PHASE_LABELS[phase]}
        </div>
      </div>

      <div className="firing-body">
        <div className="result-column">

            {result && (
              <div className="gen-gallery">
                {/* url は base64 data URL (約 2MB) のことがあるため key には使わない */}
                {result.images.map((img, i) => (
                  <button
                    key={i}
                    className={`gen-thumb ${i === selectedImage ? "selected" : ""}`}
                    onClick={() => setSelectedImage(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`生成テクスチャ ${i + 1}`} />
                    <span className="gen-thumb-caption">
                      seed {img.seed} ・ {img.elapsed_sec.toFixed(1)}s
                    </span>
                  </button>
                ))}
              </div>
            )}

            {(phase === "failed" || phase === "config") && error && (
              <div className="gen-error">
                <div className="gen-error-title">
                  {phase === "config"
                    ? "本番生成 API が未設定のため、テストピース画像で表示しています"
                    : `エラー: ${error.error}`}
                </div>
                {error.message && (
                  <div className="gen-error-message">{error.message}</div>
                )}
                {phase === "failed" && (
                  <button
                    className="btn"
                    onClick={() => setRetryKey((k) => k + 1)}
                  >
                    もう一度焼成する
                  </button>
                )}
              </div>
            )}
          </div>

        <div className="recipe recipe-grid">
            <div className="recipe-block">
              <div className="rb-ttl">基礎釉</div>
              <div className="recipe-row"><span className="key">長石</span><span className="val">40</span></div>
              <div className="recipe-row"><span className="key">石灰石</span><span className="val">15</span></div>
              <div className="recipe-row"><span className="key">珪石</span><span className="val">25</span></div>
              <div className="recipe-row"><span className="key">カオリン</span><span className="val">10</span></div>
              <div className="recipe-row"><span className="key">フリット</span><span className="val">10</span></div>
              <div className="recipe-row"><span className="key total">合計</span><span className="val total">100</span></div>
            </div>

            <div className="recipe-block">
              <div className="rb-ttl">添加物</div>
              {additives.map((a) => (
                <div className="recipe-row" key={a.key}>
                  <span className="key">{a.key}</span>
                  <span className="val">{a.val}</span>
                </div>
              ))}
            </div>

            <div className="recipe-block">
              <div className="rb-ttl">焼成条件</div>
              <div className="recipe-row">
                <span className="key">素地</span>
                <span className="val">
                  {ui.clay}
                </span>
              </div>
              <div className="recipe-row">
                <span className="key">焼成温度</span>
                <span className="val">{ui.temp}℃前後</span>
              </div>
              <div className="recipe-row">
                <span className="key">焼成雰囲気</span>
                <span className="val">{ui.atmosphere}</span>
              </div>
              <div className="recipe-row">
                <span className="key">施釉</span>
                <span className="val">{thicknessDesc(thickness)}</span>
              </div>
              <div className="recipe-row">
                <span className="key">{result ? "生成 seed" : "テストピース"}</span>
                <span className="val">
                  {currentImage
                    ? currentImage.seed
                    : glaze
                      ? `${glaze.id}（${glaze.hex}）`
                      : "-"}
                </span>
              </div>
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

            {result && (
              <div className="recipe-block recipe-block-wide">
                <div className="rb-ttl">投入プロンプト</div>
                <div className="prompt-used">{result.prompt_used}</div>
              </div>
            )}
        </div>
      </div>
    </>
  );
}
