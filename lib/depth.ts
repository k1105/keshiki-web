// 器の 3D モデルから v5 生成 API に渡す深度画像 (1024x1024 PNG) を描く。
//
// 形状は VesselCanvas の <Vessel> と同じ (回転体 + 取っ手などの付属パーツ)。
// VesselCanvas 側を変えたらここも合わせること。
//
// ⚠ 階調の向きや床の有無は depth_input_spec.md (未入手) に合わせて確定する。
// 今は: 背景 = 0 (黒)、器の手前 = 255、奥 = DEPTH_FAR_LEVEL。床は描かない。
// API 側の判定: 値 > 0 の画素が 2% 未満 → ValueError / 器の中の階調が乏しい → meta.depth.warning

import * as THREE from "three";
import { getVesselModel } from "./vessel-models";
import {
  isModelShape,
  resolveVesselSpec,
  type CustomVessel,
  type VesselShape,
} from "./vessels";

export const DEPTH_SIZE = 1024;
// 器のいちばん奥の明るさ (0-1)。背景 0 と区別できるよう底上げする
const DEPTH_FAR_LEVEL = 0.25;
// 器の大きさ (既定、全形状共通)。1 で 1024² の枠いっぱい。2026-11-04 に 0.62 → 0.97、
// 2026-11-05 に 0.92 に変更 (試験用サンプルの object_ratio は 0.2 前後だったが、器を大きく写す方針にした)。
// CaptureAngle.zoom で形ごと・デバッガーから上書きできる
export const DEPTH_ZOOM = 0.92;
/** ズームの許容範囲 (デバッガーのスライダーと clamp に使う) */
export const CAPTURE_ZOOM_RANGE: [number, number] = [0.3, 1.2];

// VesselCanvas と同じカメラ (距離・画角) で描く。
// 従来の固定位置 [0, 0.7, 4.6] を「距離 + 俯角」に分解したもの (既定の俯角 ≒ 8.65°)
const CAMERA_DISTANCE = Math.hypot(0.7, 4.6);
const CAMERA_FOV = 32;

/**
 * 深度画像を撮る角度 (度)。
 * - yaw: 器を縦軸まわりに回す角度 (正で上から見て反時計回り)。回転体では見え方は変わらない
 * - pitch: 俯角。0 で真横、正でカメラが上から見下ろす。
 *   depth_input_spec.md: 検証済みは 0° と約 13°、約 24° は失敗 (床が輪になる)
 * - zoom: 器の大きさ (枠に対する倍率)。省略時は DEPTH_ZOOM
 */
export type CaptureAngle = { yaw: number; pitch: number; zoom?: number };
export const DEFAULT_CAPTURE_ANGLE: CaptureAngle = {
  yaw: 0,
  pitch: (Math.atan2(0.7, 4.6) * 180) / Math.PI,
};
/**
 * 形ごとの撮影角度。GLB の形は回転体ではないので、正面が出る向き (yaw) が形ごとに違う。
 * ?debug=capture のデバッガーで決めた値 (角度を JSON でコピー) をここに書き戻す。無い形は DEFAULT_CAPTURE_ANGLE
 */
const CAPTURE_ANGLE_BY_SHAPE: Partial<Record<VesselShape, CaptureAngle>> = {
  haniwa: { yaw: -92, pitch: 8.7 },
  plate: { yaw: -92, pitch: 17.5 },
  handbag: { yaw: -112, pitch: 17.5 },
  teapot: { yaw: -157, pitch: 30 },
  flower: { yaw: -157, pitch: 30 },
  cat: { yaw: -90, pitch: 14.5 },
};

/** その形の既定の撮影角度 */
export function defaultCaptureAngle(shape: VesselShape): CaptureAngle {
  return CAPTURE_ANGLE_BY_SHAPE[shape] ?? DEFAULT_CAPTURE_ANGLE;
}

/** 撮影設定のズーム (省略時は DEPTH_ZOOM) */
export function captureZoom(angle: CaptureAngle): number {
  return angle.zoom ?? DEPTH_ZOOM;
}

/** 俯角の許容範囲 (デバッガーのスライダーと clamp に使う) */
export const CAPTURE_PITCH_RANGE: [number, number] = [-15, 30];
/** これを超える俯角は spec 上の失敗例 (約 24°) に近づく */
export const CAPTURE_PITCH_WARN = 15;

/** 俯角 (度) から、原点を見るカメラの位置を返す */
export function captureCameraPosition(pitch: number): [number, number, number] {
  const r = (pitch * Math.PI) / 180;
  return [0, CAMERA_DISTANCE * Math.sin(r), CAMERA_DISTANCE * Math.cos(r)];
}

/** 深度画像と同じ構図で描きたいとき用 (疑似応答の絵・デバッガー) */
export const DEPTH_CAMERA = { distance: CAMERA_DISTANCE, fov: CAMERA_FOV, zoom: DEPTH_ZOOM };

const DEPTH_VERT = /* glsl */ `
varying float vViewZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const DEPTH_FRAG = /* glsl */ `
uniform float uNear;
uniform float uFar;
uniform float uFarLevel;
varying float vViewZ;
void main() {
  float d = clamp((vViewZ - uNear) / max(uFar - uNear, 1e-5), 0.0, 1.0);
  float v = mix(1.0, uFarLevel, d);
  gl_FragColor = vec4(vec3(v), 1.0);
}
`;

/**
 * 器のメッシュ一式 (回転体 + 付属パーツ) を material で組む。呼び出し側で dispose すること。
 * yaw (度) を渡すと器を縦軸まわりに回して置く
 */
export function buildVesselGroup(
  shape: VesselShape,
  custom: CustomVessel | null,
  material: THREE.Material,
  zoom: number,
  yaw = 0
): THREE.Group {
  const spec = resolveVesselSpec(shape, custom);
  const group = new THREE.Group();
  group.scale.setScalar(spec.scale * zoom);
  group.position.set(0, (-spec.height * spec.scale * zoom) / 2, 0);
  group.rotation.y = (yaw * Math.PI) / 180;

  // GLB の形: 読み込み済みのメッシュを使う (呼び出し側で preloadVesselModel を済ませておく)。
  // 呼び出し側が dispose するのでキャッシュの複製を渡す
  if (isModelShape(shape)) {
    const geometry = getVesselModel(shape);
    if (!geometry) {
      throw new Error(`vessel model not loaded: ${shape} (call preloadVesselModel first)`);
    }
    group.add(new THREE.Mesh(geometry.clone(), material));
    return group;
  }

  const v = spec.profile.map(([x, y]) => new THREE.Vector2(x, y));
  const points = spec.smooth ? new THREE.SplineCurve(v).getPoints(48) : v;

  const add = (
    geometry: THREE.BufferGeometry,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1]
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    group.add(mesh);
  };

  add(new THREE.LatheGeometry(points, 64));

  if (shape === "mug") {
    add(new THREE.TorusGeometry(0.34, 0.075, 16, 40), [0.78, 0.78, 0]);
  }
  if (shape === "plate") {
    add(new THREE.CylinderGeometry(0.5, 0.52, 0.28, 48, 1, true), [0, 0.14, 0]);
  }
  if (shape === "bowl") {
    add(new THREE.CylinderGeometry(0.32, 0.34, 0.12, 48, 1, true), [0, 0.05, 0]);
  }
  if (shape === "teapot") {
    add(new THREE.SphereGeometry(0.45, 32, 16), [0, 1.3, 0], [0, 0, 0], [1, 0.35, 1]);
    add(new THREE.SphereGeometry(0.1, 16, 12), [0, 1.52, 0]);
    add(new THREE.CylinderGeometry(0.07, 0.15, 0.75, 20), [1.05, 0.85, 0], [0, 0, -0.9]);
    add(new THREE.TorusGeometry(0.32, 0.06, 16, 36), [-1.05, 0.75, 0], [0, 0, 0.2]);
  }
  return group;
}

export type DepthRenderOptions = {
  /** 撮る角度。既定 DEFAULT_CAPTURE_ANGLE */
  angle?: CaptureAngle;
  /** 器の大きさ。既定は angle.zoom、無ければ DEPTH_ZOOM */
  zoom?: number;
  /** 一辺 (px)。API に送るのは DEPTH_SIZE 固定。デバッガーの覗き見用に小さく描ける */
  size?: number;
};

/** 深度画像の検算 (depth_input_spec.md 1)。API 側の meta.depth.object_ratio / object_std に相当 */
export type DepthStats = {
  /** 器 (値 > 0) の画素が全体に占める割合 0-1。検証済みの範囲は 0.15〜0.45 */
  objectRatio: number;
  /** 器の中の値 (0-255) の標準偏差。40 以上が目安 */
  objectStd: number;
};

/**
 * 器の深度画像を base64 PNG (data URL) で返す。
 * WebGL のコンテキストは描画後に必ず破棄する (長時間稼働対策)。
 */
export function renderVesselDepthPng(
  shape: VesselShape,
  custom: CustomVessel | null,
  options: DepthRenderOptions = {}
): string {
  return renderDepth(shape, custom, options, false).dataUrl;
}

/** 深度画像と検算値をまとめて返す (デバッガー用) */
export function renderVesselDepthPreview(
  shape: VesselShape,
  custom: CustomVessel | null,
  options: DepthRenderOptions = {}
): { dataUrl: string; stats: DepthStats } {
  const r = renderDepth(shape, custom, options, true);
  return { dataUrl: r.dataUrl, stats: r.stats! };
}

function renderDepth(
  shape: VesselShape,
  custom: CustomVessel | null,
  { angle = DEFAULT_CAPTURE_ANGLE, zoom = captureZoom(angle), size = DEPTH_SIZE }: DepthRenderOptions,
  withStats: boolean
): { dataUrl: string; stats?: DepthStats } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 1);

  const material = new THREE.ShaderMaterial({
    vertexShader: DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
    uniforms: {
      uNear: { value: 0 },
      uFar: { value: 1 },
      uFarLevel: { value: DEPTH_FAR_LEVEL },
    },
    side: THREE.DoubleSide,
  });

  const scene = new THREE.Scene();
  const group = buildVesselGroup(shape, custom, material, zoom, angle.yaw);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(...captureCameraPosition(angle.pitch));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  try {
    // 器の手前 (バウンディングボックスの最も近い角) 〜 中心軸までを階調に割り当てる。
    // 回転体の見えている面はほぼこの範囲に収まるので、ボックス全体で正規化するより階調が広くとれる
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const viewInv = camera.matrixWorldInverse;
    let near = Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      );
      near = Math.min(near, -corner.applyMatrix4(viewInv).z);
    }
    const far = -box.getCenter(new THREE.Vector3()).applyMatrix4(viewInv).z;
    material.uniforms.uNear.value = near;
    material.uniforms.uFar.value = far;

    renderer.render(scene, camera);
    const stats = withStats ? readDepthStats(renderer, size) : undefined;
    return { dataUrl: canvas.toDataURL("image/png"), stats };
  } finally {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** 描いた直後のフレームバッファから検算値を読む (preserveDrawingBuffer 前提) */
function readDepthStats(renderer: THREE.WebGLRenderer, size: number): DepthStats {
  const gl = renderer.getContext();
  const px = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i]; // グレースケールなので R だけ見る
    if (v === 0) continue;
    n++;
    sum += v;
    sumSq += v * v;
  }
  if (n === 0) return { objectRatio: 0, objectStd: 0 };
  const mean = sum / n;
  return {
    objectRatio: n / (size * size),
    objectStd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
  };
}
