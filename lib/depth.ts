// 器の 3D モデルから v5 生成 API に渡す深度画像 (1024x1024 PNG) を描く。
//
// 形状は VesselCanvas の <Vessel> と同じ (回転体 + 取っ手などの付属パーツ)。
// VesselCanvas 側を変えたらここも合わせること。
//
// ⚠ 階調の向きや床の有無は depth_input_spec.md (未入手) に合わせて確定する。
// 今は: 背景 = 0 (黒)、器の手前 = 255、奥 = DEPTH_FAR_LEVEL。床は描かない。
// API 側の判定: 値 > 0 の画素が 2% 未満 → ValueError / 器の中の階調が乏しい → meta.depth.warning

import * as THREE from "three";
import {
  resolveVesselSpec,
  type CustomVessel,
  type VesselShape,
} from "./vessels";

export const DEPTH_SIZE = 1024;
// 器のいちばん奥の明るさ (0-1)。背景 0 と区別できるよう底上げする
const DEPTH_FAR_LEVEL = 0.25;
// 器の大きさ。1 だと 1024² の枠いっぱいになるので、空間 (卓・壁) が入る余白をとる
// (試験用サンプルの object_ratio は 0.2 前後)
const DEPTH_ZOOM = 0.62;

// VesselCanvas と同じカメラ (位置・画角) で描く
const CAMERA_POSITION: [number, number, number] = [0, 0.7, 4.6];
const CAMERA_FOV = 32;
/** 深度画像と同じ構図で描きたいとき用 (疑似応答の絵など) */
export const DEPTH_CAMERA = { position: CAMERA_POSITION, fov: CAMERA_FOV, zoom: DEPTH_ZOOM };

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

/** 器のメッシュ一式 (回転体 + 付属パーツ) を material で組む。呼び出し側で dispose すること */
export function buildVesselGroup(
  shape: VesselShape,
  custom: CustomVessel | null,
  material: THREE.Material,
  zoom: number
): THREE.Group {
  const spec = resolveVesselSpec(shape, custom);
  const v = spec.profile.map(([x, y]) => new THREE.Vector2(x, y));
  const points = spec.smooth ? new THREE.SplineCurve(v).getPoints(48) : v;

  const group = new THREE.Group();
  group.scale.setScalar(spec.scale * zoom);
  group.position.set(0, (-spec.height * spec.scale * zoom) / 2, 0);

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

/**
 * 器の深度画像を base64 PNG (data URL) で返す。
 * WebGL のコンテキストは描画後に必ず破棄する (長時間稼働対策)。
 */
export function renderVesselDepthPng(
  shape: VesselShape,
  custom: CustomVessel | null,
  zoom = DEPTH_ZOOM
): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = DEPTH_SIZE;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(DEPTH_SIZE, DEPTH_SIZE, false);
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
  const group = buildVesselGroup(shape, custom, material, zoom);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(...CAMERA_POSITION);
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
    return canvas.toDataURL("image/png");
  } finally {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
