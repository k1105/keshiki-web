"use client";

import { useEffect, useRef, useState } from "react";
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
import type { Strings } from "@/lib/i18n";

export type FiringPanelProps = {
  /** Step 3 が表示されているか。非表示中は進行中のジョブをキャンセルする */
  active: boolean;
  /** 「焼成する」を押すたびに増える。値が変わったら新しく焼成する */
  fireKey: number;
  ui: FiringUiState;
  thickness: number;
  t: Strings;
  /** 焼き上がった生成テクスチャ。未生成・生成前は null */
  onTexture: (url: string | null) => void;
  /** 生成中かどうか。次のステップへの遷移を止めるために使う */
  onGeneratingChange: (generating: boolean) => void;
};

// 生成の進行状態。config は本番 API 未設定 (単色表示のまま案内を出す)
type Phase =
  | "submitting"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "config";

const POLL_MS = 2000; // ガイドの推奨: 1〜2 秒間隔でポーリング

export default function FiringPanel({
  active,
  fireKey,
  ui,
  thickness,
  t,
  onTexture,
  onGeneratingChange,
}: FiringPanelProps) {
  const [phase, setPhase] = useState<Phase>("submitting");
  const [error, setError] = useState<GenerateError | null>(null);
  const [result, setResult] = useState<GenerateOutput | null>(null);
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
  const textureUrl = result?.images[0]?.url ?? null;

  // 焼き上がったら生成テクスチャを器のプレビューへ反映する
  useEffect(() => {
    callbacksRef.current.onTexture(textureUrl);
  }, [textureUrl]);
  useEffect(() => {
    callbacksRef.current.onGeneratingChange(generating);
  }, [generating]);

  if (!active) return null;

  // 焼成中は全画面の焼成演出になり、進行状況だけを中央に出す
  if (phase === "submitting" || phase === "queued" || phase === "running") {
    return (
      <div className="firing-label" role="status">
        <div className="firing-title">{t.firing}</div>
        <div className="firing-phase">{t.phases[phase]}</div>
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
              {t.retry}
            </button>
          )}
        </div>
      )}

      {/* レシピ本文はデザインに合わせて言語切替に関わらず日本語表記 */}
      <div className="recipe-body">
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
            <span className="val">{ui.clay}</span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成温度</span>
            <span className="val">{ui.temp}℃</span>
          </div>
          <div className="recipe-row">
            <span className="key">- 焼成雰囲気</span>
            <span className="val">{ui.atmosphere}</span>
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
