"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomVessel } from "@/lib/vessels";

// 描画座標系（デザイン px）。表示サイズは CSS でパネルいっぱいに伸縮する
const W = 830;
const H = 830;
const AXIS_X = W / 2; // 回転軸の x 座標（パネル中央）
const AXIS_TOP = 106;
const AXIS_BOTTOM = 686;
const INK = "#39224c";
const PINK = "#e26a98";

// w は描画用の線の太さ (描く速さで決まる)。形の計算には使わない
type Pt = { x: number; y: number; w?: number };

// 線の強弱: ゆっくり描いたところは太く、速く描いたところは細くなる (筆圧の代わりに速さを使う)
const LINE_MAX = 3.6;
const LINE_MIN = 1.1;
const LINE_START = 2.4;
// この速さ (描画座標 px / ms) 以上はいちばん細い
const SPEED_THIN = 1.6;
// 太さは前の点から少しずつ寄せる (急に変えない)
const LINE_EASE = 0.3;

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

/**
 * 一筆書きでかたちを描く。線を描き終えてもすぐには決めず、OK で確定、Clear で描き直す
 */
export default function ProfileSketcher({
  onShapeDrawn,
  hint,
  tooShortText,
  clearLabel,
  okLabel,
}: {
  onShapeDrawn: (v: CustomVessel) => void;
  hint: string;
  tooShortText: string;
  clearLabel: string;
  okLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<Pt[]>([]);
  const drawingRef = useRef(false);
  // 直前の点を打った時刻 (描く速さの計算用)
  const lastTimeRef = useRef(0);
  const [tooShort, setTooShort] = useState(false);
  // 描き終えた線からつくった形 (OK で確定する)。線が無い・短すぎるときは null
  const [drawn, setDrawn] = useState<CustomVessel | null>(null);
  const [hasStroke, setHasStroke] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // 回転軸: 細い破線と両端の丸
    ctx.beginPath();
    ctx.setLineDash([7, 5]);
    ctx.moveTo(AXIS_X, AXIS_TOP);
    ctx.lineTo(AXIS_X, AXIS_BOTTOM);
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PINK;
    for (const y of [AXIS_TOP, AXIS_BOTTOM]) {
      ctx.beginPath();
      ctx.arc(AXIS_X, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const stroke = strokeRef.current;
    if (stroke.length === 0) return;

    // 点ごとに太さが違うので、区間ごとに線を引く (端は丸めてつなぎ目を埋める)
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1];
      const b = stroke[i];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = ((a.w ?? LINE_START) + (b.w ?? LINE_START)) / 2;
      ctx.stroke();
    }
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

  // 表示サイズ → 描画座標 (W x H) に換算する
  const toLocal = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * W) / rect.width;
    const y = ((e.clientY - rect.top) * H) / rect.height;
    return {
      x: Math.min(W - 2, Math.max(AXIS_X, x)),
      y: Math.min(H - 2, Math.max(2, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastTimeRef.current = e.timeStamp;
    strokeRef.current = [{ ...toLocal(e), w: LINE_START }];
    setTooShort(false);
    setDrawn(null);
    setHasStroke(true);
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const p = toLocal(e);
    const stroke = strokeRef.current;
    const last = stroke[stroke.length - 1];
    const dist = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0;
    if (last && dist < 1.5) return;
    const dt = Math.max(1, e.timeStamp - lastTimeRef.current);
    lastTimeRef.current = e.timeStamp;
    const speed = Math.min(1, dist / dt / SPEED_THIN);
    const target = LINE_MAX + (LINE_MIN - LINE_MAX) * speed;
    const prev = last?.w ?? LINE_START;
    stroke.push({ ...p, w: prev + (target - prev) * LINE_EASE });
    redraw();
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const vessel = strokeToVessel(strokeRef.current);
    if (vessel) {
      setDrawn(vessel);
    } else {
      strokeRef.current = [];
      setHasStroke(false);
      setTooShort(true);
      redraw();
    }
  };

  const clear = () => {
    drawingRef.current = false;
    strokeRef.current = [];
    setDrawn(null);
    setHasStroke(false);
    setTooShort(false);
    redraw();
  };

  return (
    <div className="sketcher">
      <canvas
        ref={canvasRef}
        className="sketch-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className={`sketch-hint ${tooShort ? "is-warn" : ""}`}>
        {tooShort ? tooShortText : hint}
      </div>
      <div className="panel-foot">
        <button type="button" className="btn is-dark" disabled={!hasStroke} onClick={clear}>
          {clearLabel}
        </button>
        <button
          type="button"
          className="btn is-dark"
          disabled={!drawn}
          onClick={() => drawn && onShapeDrawn(drawn)}
        >
          {okLabel}
        </button>
      </div>
    </div>
  );
}
