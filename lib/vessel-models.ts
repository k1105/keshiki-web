// 回転体では作れない形 (埴輪・バッグ・花・猫) の GLB を読み込み、回転体と同じ置き方に正規化する。
//
// - GLB は Tripo (scripts/tripo-generate.mjs) で生成した低ポリの素のメッシュ (テクスチャなし)。
//   色・質感はアプリ側の釉薬マテリアルを着せるので、ここでは形だけを使う
// - 正規化: 全メッシュを 1 つのジオメトリにまとめ、底を y=0、中心を x=z=0 に置き、高さを
//   MODEL_SHAPES[key].height に揃える (回転体のプロファイルと同じ座標系)
// - 読み込みは 1 度だけ。キャッシュのジオメトリは共有物なので dispose しないこと。
//   使う側で加工・破棄するなら clone() を渡す (lib/depth.ts buildVesselGroup)

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { isModelShape, MODEL_SHAPES, type ModelShapeKey, type VesselShape } from "./vessels";

const cache = new Map<ModelShapeKey, THREE.BufferGeometry>();
const pending = new Map<ModelShapeKey, Promise<THREE.BufferGeometry>>();

/** 読み込み済みならジオメトリを返す (同期)。未読み込みなら null */
export function getVesselModel(key: ModelShapeKey): THREE.BufferGeometry | null {
  return cache.get(key) ?? null;
}

/** GLB を読み込んで正規化したジオメトリを返す (キャッシュあり) */
export function loadVesselModel(key: ModelShapeKey): Promise<THREE.BufferGeometry> {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const model = MODEL_SHAPES[key];
  const p = new GLTFLoader()
    .loadAsync(model.url)
    .then((gltf) => {
      const geometry = mergeScene(gltf.scene);
      disposeScene(gltf.scene);
      normalize(geometry, model.height);
      cache.set(key, geometry);
      return geometry;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, p);
  return p;
}

/** 形が GLB なら読み込みを済ませる。回転体の形なら何もしない */
export async function preloadVesselModel(shape: VesselShape): Promise<void> {
  if (isModelShape(shape)) await loadVesselModel(shape);
}

// ---- 内部 ----

/**
 * シーン内の全メッシュをワールド座標に展開して 1 つの非インデックスジオメトリにまとめる。
 * 属性は position / normal / uv だけ残す (釉薬マテリアルの map は uv を参照するので、無ければ 0 で埋める)
 */
function mergeScene(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3();

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const src = obj.geometry as THREE.BufferGeometry;
    const geo = src.index ? src.toNonIndexed() : src.clone();
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const uv = geo.getAttribute("uv");
    normalMatrix.getNormalMatrix(obj.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      positions.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      normals.push(v.x, v.y, v.z);
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0, 0);
    }
    geo.dispose();
  });

  if (positions.length === 0) throw new Error("vessel model: no mesh in GLB");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** 底を y=0、中心を x=z=0 に置き、高さを height に揃える */
function normalize(geometry: THREE.BufferGeometry, height: number) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.scale(height / Math.max(size.y, 1e-6), height / Math.max(size.y, 1e-6), height / Math.max(size.y, 1e-6));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** GLTF のシーンが持つ GPU リソース (元のジオメトリ・マテリアル・テクスチャ) を解放する */
function disposeScene(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      m.dispose();
    }
  });
}
