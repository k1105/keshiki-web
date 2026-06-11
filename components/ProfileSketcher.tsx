"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomVessel } from "@/lib/vessels";

const W = 340;
const H = 340;
const AXIS_X = 56; // 回転軸の x 座標
const PAD = 14;

type Pt = { x: number; y: number };

// ストロークを弧長基準で n 点に等間隔リサンプリングする
function resample(pts: Pt[], n: number): Pt[] {
  const dists = [0];
  for (let i = 1; i < pts.length; i++) {
    dists.push(
      dists[i - 1] +
        Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    );
  }
  const total = dists[dists.length - 1];
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < pts.length - 2 && dists[seg + 1] < target) seg++;
    const span = dists[seg + 1] - dists[seg] || 1;
    const t = (target - dists[seg]) / span;
    out.push({
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t,
    });
  }
  return out;
}

function strokeToVessel(raw: Pt[]): CustomVessel | null {
  if (raw.length < 4) return null;
  let len = 0;
  for (let i = 1; i < raw.length; i++) {
    len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
  }
  if (len < 40) return null;

  const pts = resample(raw, 32);
  // キャンバス座標 → 断面プロファイル（r = 軸からの距離, y = 下からの高さ）
  const prof = pts.map((p) => ({
    r: Math.max(0, p.x - AXIS_X),
    y: H - p.y,
  }));
  // プロファイルは底 → 口の順に並べる
  if (prof[0].y > prof[prof.length - 1].y) prof.reverse();

  const ys = prof.map((p) => p.y);
  const minY = Math.min(...ys);
  const height = Math.max(Math.max(...ys) - minY, 8);
  const maxR = Math.max(...prof.map((p) => p.r), 8);
  // 既存プリセットと同程度のサイズに収める（高さ ~2.2 / 半径 ~1.35 上限）
  const scale = Math.min(2.2 / height, 1.35 / maxR);

  const profile: [number, number][] = prof.map((p) => [
    p.r * scale,
    (p.y - minY) * scale,
  ]);
  // 描き始めが軸から離れていたら底面を閉じる
  if (profile[0][0] > 0.04) profile.unshift([0, profile[0][1]]);

  return { profile, height: height * scale };
}

export default function ProfileSketcher({
  onShapeDrawn,
}: {
  onShapeDrawn: (v: CustomVessel) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<Pt[]>([]);
  const drawingRef = useRef(false);
  const [status, setStatus] = useState<"empty" | "drawn" | "too-short">(
    "empty"
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // 回転軸
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.moveTo(AXIS_X, PAD);
    ctx.lineTo(AXIS_X, H - PAD);
    ctx.strokeStyle = "rgba(44, 89, 80, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(44, 89, 80, 0.55)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.save();
    ctx.translate(AXIS_X - 8, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("回転軸", 0, 0);
    ctx.restore();

    const stroke = strokeRef.current;
    if (stroke.length === 0) {
      ctx.fillStyle = "rgba(31, 37, 35, 0.35)";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("軸の右側に、器の輪郭（断面）を", (W + AXIS_X) / 2, H / 2 - 10);
      ctx.fillText("一筆で描いてください", (W + AXIS_X) / 2, H / 2 + 10);
      return;
    }

    const trace = (mirror: boolean) => {
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const x = mirror ? AXIS_X * 2 - p.x : p.x;
        if (i === 0) ctx.moveTo(x, p.y);
        else ctx.lineTo(x, p.y);
      });
      ctx.stroke();
    };

    // 鏡映側（シルエットのあたり）
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(44, 89, 80, 0.18)";
    trace(true);

    // 描画ストローク
    ctx.strokeStyle = "#2c5950";
    ctx.lineWidth = 2.5;
    trace(false);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.getContext("2d")?.scale(dpr, dpr);
    redraw();
  }, [redraw]);

  const toLocal = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(W - 2, Math.max(AXIS_X, e.clientX - rect.left)),
      y: Math.min(H - 2, Math.max(2, e.clientY - rect.top)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokeRef.current = [toLocal(e)];
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const p = toLocal(e);
    const stroke = strokeRef.current;
    const last = stroke[stroke.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
    stroke.push(p);
    redraw();
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const vessel = strokeToVessel(strokeRef.current);
    if (vessel) {
      onShapeDrawn(vessel);
      setStatus("drawn");
    } else {
      strokeRef.current = [];
      setStatus("too-short");
      redraw();
    }
  };

  const clear = () => {
    strokeRef.current = [];
    drawingRef.current = false;
    setStatus("empty");
    redraw();
  };

  return (
    <div className="sketcher">
      <div className="sketch-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="sketch-canvas"
          style={{ width: W, height: H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <div className="sketch-side">
        <div className="sketch-guide">
          <p>
            点線の<strong>回転軸</strong>を中心に、描いた線（断面の輪郭）を
            360°回転させて器の形をつくります。ろくろを挽くイメージで、
            底から口へ向かって一筆で描いてください。
          </p>
          <p className="sketch-hint">
            描き終わると右のプレビューに3D形状が反映されます。
            納得がいくまで何度でも描き直せます。
          </p>
        </div>

        {status === "drawn" && (
          <div className="sketch-status ok">3D形状を生成しました</div>
        )}
        {status === "too-short" && (
          <div className="sketch-status warn">
            線が短すぎます。もう少し長く描いてください
          </div>
        )}

        <button className="btn" onClick={clear}>
          クリア
        </button>
      </div>
    </div>
  );
}
