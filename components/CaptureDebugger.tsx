"use client";

// 深度画像を撮る角度 (ヨー・俯角) とズーム (器の大きさ) を決めるためのデバッガー。URL に ?debug=capture で開く。
//
// 左: 深度画像と同じカメラ (lib/depth.ts) で描いた器。ドラッグで回す (横 = ヨー、縦 = 俯角)
// 右: その角度で実際に描いた深度画像 (縮小) と、depth_input_spec.md の検算値
// ここで決めた角度・ズームは page.tsx の captureAngle になり、焼成時の renderVesselDepthPng に渡る

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import {
  buildVesselGroup,
  CAPTURE_PITCH_RANGE,
  CAPTURE_PITCH_WARN,
  CAPTURE_ZOOM_RANGE,
  captureCameraPosition,
  captureZoom,
  defaultCaptureAngle,
  DEPTH_CAMERA,
  DEPTH_SIZE,
  DEPTH_ZOOM,
  renderVesselDepthPng,
  renderVesselDepthPreview,
  type CaptureAngle,
  type DepthStats,
} from "@/lib/depth";
import { preloadVesselModel } from "@/lib/vessel-models";
import { resolveVesselSpec, type CustomVessel, type VesselShape } from "@/lib/vessels";

const PREVIEW_SIZE = 256;
const PREVIEW_DEBOUNCE_MS = 120;
// ドラッグ 1px あたりの回転量 (度)
const DRAG_YAW_PER_PX = 0.5;
const DRAG_PITCH_PER_PX = 0.25;
// spec の検証済み範囲
const RATIO_RANGE: [number, number] = [0.15, 0.45];
const STD_MIN = 40;

export type CaptureDebuggerProps = {
  shape: VesselShape;
  custom: CustomVessel | null;
  angle: CaptureAngle;
  onChange: (angle: CaptureAngle) => void;
  onClose: () => void;
};

function clampPitch(p: number) {
  return Math.min(CAPTURE_PITCH_RANGE[1], Math.max(CAPTURE_PITCH_RANGE[0], p));
}

function clampZoom(z: number) {
  if (!Number.isFinite(z)) return DEPTH_ZOOM;
  return Math.min(CAPTURE_ZOOM_RANGE[1], Math.max(CAPTURE_ZOOM_RANGE[0], z));
}

/** -180 < yaw <= 180 に畳む */
function wrapYaw(y: number) {
  const w = ((((y + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/** 俯角に合わせてカメラを置く。Canvas の既定カメラを直接動かす */
function CaptureCamera({ pitch }: { pitch: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(...captureCameraPosition(pitch));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, pitch]);
  return null;
}

/** 深度画像と同じ組み方 (buildVesselGroup) の器を、同じ zoom・ヨーで置く */
function CaptureVessel({
  shape,
  custom,
  yaw,
  zoom,
}: {
  shape: VesselShape;
  custom: CustomVessel | null;
  yaw: number;
  zoom: number;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    let built: THREE.Group | null = null;
    let material: THREE.Material | null = null;
    preloadVesselModel(shape)
      .then(() => {
        if (cancelled) return;
        material = new THREE.MeshStandardMaterial({
          color: "#c9bfae",
          roughness: 0.6,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        built = buildVesselGroup(shape, custom, material, zoom);
        setGroup(built);
      })
      .catch((e) => console.error("capture debugger: vessel build failed", e));
    return () => {
      cancelled = true;
      setGroup(null);
      built?.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      material?.dispose();
    };
  }, [shape, custom, zoom]);

  useEffect(() => {
    if (group) group.rotation.y = (yaw * Math.PI) / 180;
  }, [group, yaw]);

  if (!group) return null;
  return <primitive object={group} />;
}

export default function CaptureDebugger({
  shape,
  custom,
  angle,
  onChange,
  onClose,
}: CaptureDebuggerProps) {
  const [preview, setPreview] = useState<{ dataUrl: string; stats: DepthStats } | null>(null);
  const [copied, setCopied] = useState(false);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const angleRef = useRef(angle);
  angleRef.current = angle;

  // 角度・形が変わったら少し待って深度画像を描き直す (描くたびに WebGL コンテキストを作って捨てる)
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      preloadVesselModel(shape)
        .then(() => {
          if (cancelled) return;
          setPreview(renderVesselDepthPreview(shape, custom, { angle, size: PREVIEW_SIZE }));
        })
        .catch((e) => console.error("capture debugger: depth preview failed", e));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shape, custom, angle]);

  const set = (next: Partial<CaptureAngle>) => {
    const cur = angleRef.current;
    onChange({
      yaw: wrapYaw(next.yaw ?? cur.yaw),
      pitch: clampPitch(next.pitch ?? cur.pitch),
      zoom: clampZoom(next.zoom ?? captureZoom(cur)),
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ...angleRef.current };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    set({
      yaw: d.yaw + (e.clientX - d.x) * DRAG_YAW_PER_PX,
      pitch: d.pitch + (e.clientY - d.y) * DRAG_PITCH_PER_PX,
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const savePng = async () => {
    await preloadVesselModel(shape);
    const url = renderVesselDepthPng(shape, custom, { angle });
    const a = document.createElement("a");
    a.href = url;
    a.download = `depth_${shape}_yaw${round1(angle.yaw)}_pitch${round1(angle.pitch)}_zoom${round2(zoom)}.png`;
    a.click();
  };

  const copyJson = async () => {
    const json = JSON.stringify({
      yaw: round1(angle.yaw),
      pitch: round1(angle.pitch),
      zoom: round2(zoom),
    });
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      console.error("clipboard write failed", e, json);
    }
  };

  const stats = preview?.stats;
  const ratioOk =
    stats && stats.objectRatio >= RATIO_RANGE[0] && stats.objectRatio <= RATIO_RANGE[1];
  const stdOk = stats && stats.objectStd >= STD_MIN;
  const camPos = captureCameraPosition(angle.pitch);
  const zoom = captureZoom(angle);
  // 器の底の高さ (buildVesselGroup と同じ置き方)。床の格子をここに置く
  const spec = resolveVesselSpec(shape, custom);
  const floorY = (-spec.height * spec.scale * zoom) / 2;

  return (
    <div className="capdbg" role="dialog" aria-label="撮影角度デバッガー">
      <div className="capdbg-head">
        <span>撮影角度デバッガー</span>
        <span className="capdbg-dim">
          {shape} / 1024² / fov {DEPTH_CAMERA.fov}° / zoom {round2(zoom)}
        </span>
        <button type="button" className="capdbg-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <div className="capdbg-views">
        <div className="capdbg-view">
          <div
            className="capdbg-3d"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Canvas
              dpr={[1, 2]}
              camera={{ fov: DEPTH_CAMERA.fov, near: 0.1, far: 100, position: camPos }}
              gl={{ antialias: true }}
            >
              <color attach="background" args={["#2a2433"]} />
              <ambientLight intensity={0.9} />
              <directionalLight position={[3, 5, 2]} intensity={2.2} />
              <directionalLight position={[-3, 2, -3]} intensity={0.6} />
              <CaptureCamera pitch={angle.pitch} />
              <CaptureVessel shape={shape} custom={custom} yaw={angle.yaw} zoom={zoom} />
              {/* 床の格子。俯角の見当をつけるためだけに置く (深度には描かない) */}
              <gridHelper args={[6, 12, "#6a5d80", "#443a55"]} position={[0, floorY, 0]} />
            </Canvas>
          </div>
          <div className="capdbg-cap">ドラッグで回す (横: ヨー / 縦: 俯角)</div>
        </div>

        <div className="capdbg-view">
          <div className="capdbg-depth">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.dataUrl} alt="深度画像のプレビュー" />
            ) : (
              <span className="capdbg-dim">描画中…</span>
            )}
          </div>
          <div className="capdbg-cap">API に送る深度画像 ({PREVIEW_SIZE}px に縮小)</div>
        </div>
      </div>

      <label className="capdbg-row">
        <span className="capdbg-lbl">ヨー</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={round1(angle.yaw)}
          onChange={(e) => set({ yaw: Number(e.target.value) })}
        />
        <input
          type="number"
          className="capdbg-num"
          step={1}
          value={round1(angle.yaw)}
          onChange={(e) => set({ yaw: Number(e.target.value) })}
        />
        <span className="capdbg-unit">°</span>
      </label>

      <label className="capdbg-row">
        <span className="capdbg-lbl">俯角</span>
        <input
          type="range"
          min={CAPTURE_PITCH_RANGE[0]}
          max={CAPTURE_PITCH_RANGE[1]}
          step={0.5}
          value={round1(angle.pitch)}
          onChange={(e) => set({ pitch: Number(e.target.value) })}
        />
        <input
          type="number"
          className="capdbg-num"
          step={0.5}
          value={round1(angle.pitch)}
          onChange={(e) => set({ pitch: Number(e.target.value) })}
        />
        <span className="capdbg-unit">°</span>
      </label>
      <label className="capdbg-row">
        <span className="capdbg-lbl">ズーム</span>
        <input
          type="range"
          min={CAPTURE_ZOOM_RANGE[0]}
          max={CAPTURE_ZOOM_RANGE[1]}
          step={0.01}
          value={round2(zoom)}
          onChange={(e) => set({ zoom: Number(e.target.value) })}
        />
        <input
          type="number"
          className="capdbg-num"
          step={0.01}
          value={round2(zoom)}
          onChange={(e) => set({ zoom: Number(e.target.value) })}
        />
        <span className="capdbg-unit">×</span>
      </label>
      {angle.pitch > CAPTURE_PITCH_WARN && (
        <div className="capdbg-warn">
          ⚠ 俯角 {CAPTURE_PITCH_WARN}° 超。spec では約 24° の見下ろしで失敗 (検証済みは 0° と約 13°)
        </div>
      )}

      <div className="capdbg-stats">
        <span className={ratioOk ? "is-ok" : "is-ng"}>
          器の面積 {stats ? `${(stats.objectRatio * 100).toFixed(1)}%` : "–"}
          <span className="capdbg-dim"> (15〜45%)</span>
        </span>
        <span className={stdOk ? "is-ok" : "is-ng"}>
          器内 std {stats ? stats.objectStd.toFixed(1) : "–"}
          <span className="capdbg-dim"> (≥ {STD_MIN})</span>
        </span>
        <span className="capdbg-dim">
          camera [{camPos.map((v) => v.toFixed(2)).join(", ")}]
        </span>
      </div>

      <div className="capdbg-actions">
        <button type="button" onClick={() => onChange(defaultCaptureAngle(shape))}>
          既定に戻す
        </button>
        <button type="button" onClick={savePng}>
          PNG ({DEPTH_SIZE}²) を保存
        </button>
        <button type="button" onClick={copyJson}>
          {copied ? "コピーした" : "角度・ズームを JSON でコピー"}
        </button>
      </div>
    </div>
  );
}
