// 焼成フローの疑似応答 (モック)。API を叩かずに v5 → 3D の途中経過と結果を
// 仕様書の実測時刻 (docs/api/serverless_api_progress.md 1 の「両方温まっている」列) で再生する。
// 演出 (温度・途中の絵・粒・GLB) の確認用。本番の応答の形 (JobStatusResponseV5 / 3D) に合わせてある。
//
// 作るもの (すべてブラウザで生成):
// - 器の写真: 選んだ形を釉薬の色で描いた 1024px PNG (v5 の images[0].url 相当)
// - 途中の絵: 同じ絵をぼかしたもの 10 枚 (step 3, 6, ..., 30)
// - 切り抜き: 白背景 384px JPEG
// - 粒: 器の表面から採った点を 32³ / 64³ / 1024³ の格子座標 (z が上) に落としたもの
// - GLB: 器のメッシュを GLTFExporter で書き出したもの (色つき / 色なし)
//
// 本物と同じく、入力に知らないキーがあると ValueError で FAILED にする。

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import {
  buildVesselGroup,
  captureCameraPosition,
  captureZoom,
  DEFAULT_CAPTURE_ANGLE,
  DEPTH_CAMERA,
  type CaptureAngle,
} from "./depth";
import { preloadVesselModel } from "./vessel-models";
import type { GenerateInput3D, GenerateOutput3D, Points3D, Progress3D } from "./generate_3d";
import type {
  GenerateInputV5,
  GenerateOutputV5,
  PreviewFrameV5,
  ProgressV5,
  RecipeV5,
} from "./generate_v5";
import type { JobStatus } from "./glaze_prompt";
import type { JobApi, JobClient, JobStatusAny } from "./job-client";
import type { CustomVessel, VesselShape } from "./vessels";

export type MockVessel = {
  shape: VesselShape;
  custom: CustomVessel | null;
  /** 深度画像を撮った角度。疑似応答の絵も同じ角度で描く (省略で既定) */
  angle?: CaptureAngle;
};

export type MockOptions = {
  /** 絵・粒を作るための器の形 (本物は深度画像から推定するが、モックは形を直接もらう) */
  getVessel: () => MockVessel;
  /** 進む速さ (1 = 実測どおり) */
  speed?: number;
};

// 本物の v5 / 3D が受け付けるキー (これ以外は ValueError)
const V5_KEYS = ["depth_png", "depth_preset", "glaze", "scene", "gen_params", "preview"];
const D3_KEYS = ["image", "quality", "seed", "detail"];

const GEN_STEPS = 30;
const PREVIEW_T0 = 4.6; // 最初の途中の絵 (焼成ボタンからの秒)
const PREVIEW_T1 = 34.0; // 最後の途中の絵
const V5_DONE_T = 37.3;
const D3_QUEUE_T = 1.5; // 3D の順番待ち (v5 完了からの秒)
// 3D の各段階 (3D の worker が job を受け取ってからの秒)
const D3_STAGES: [string, number][] = [
  ["ready", 0.1],
  ["cutout", 1.2],
  ["coarse_shape", 4.8],
  ["fine_shape", 12.3],
  ["shape_mesh", 13.2],
  ["texture_latent", 16.0],
  ["color_points", 17.3],
];
const D3_DONE_DETAIL_T = 33.6;
const D3_DONE_PLAIN_T = 23.0;

type Frame = { at: number; status: JobStatus; output?: unknown; error?: string };

type MockJob = {
  api: JobApi;
  frames: Promise<Frame[]>;
  /** 素材ができて再生を始めた時刻 (ms)。できるまでは IN_QUEUE */
  t0: number | null;
  cancelled: boolean;
};

function valueError(message: string): Frame[] {
  return [{ at: 0, status: "FAILED", error: "ValueError", output: { message } }];
}

function unknownKeys(input: object, allowed: string[]): string[] {
  return Object.keys(input).filter((k) => !allowed.includes(k)).sort();
}

export function createMockJobClient(options: MockOptions): JobClient {
  const speed = options.speed ?? 1;
  const jobs = new Map<string, MockJob>();
  let seq = 0;

  return {
    async submit(api, input) {
      const id = `mock-${api}-${++seq}`;
      const frames =
        api === "v5"
          ? buildV5Frames(input as GenerateInputV5, options.getVessel())
          : build3DFrames(input as GenerateInput3D, options.getVessel());
      const job: MockJob = { api, frames, t0: null, cancelled: false };
      jobs.set(id, job);
      // 素材ができた時点から時計を進める
      frames.then(() => {
        job.t0 = Date.now();
      });
      return { ok: true, id };
    },
    async status(api, id) {
      const job = jobs.get(id);
      if (!job || job.api !== api) {
        return { ok: false, status: 404, error: { error: "not_found", message: `mock job ${id}` } };
      }
      const base: JobStatusAny = { id, status: "IN_QUEUE" };
      if (job.cancelled) return { ok: true, data: { ...base, status: "CANCELLED" } };
      if (job.t0 === null) return { ok: true, data: base };
      const frames = await job.frames;
      const elapsed = ((Date.now() - job.t0) / 1000) * speed;
      let current: Frame | null = null;
      for (const f of frames) if (f.at <= elapsed) current = f;
      if (!current) return { ok: true, data: base };
      return {
        ok: true,
        data: { ...base, status: current.status, output: current.output, error: current.error },
      };
    },
    cancel(_api, id) {
      const job = jobs.get(id);
      if (job) job.cancelled = true;
    },
  };
}

// ---- v5 ----

function colorOf(input: GenerateInputV5): string {
  const g = input.glaze;
  if (g && "color" in g && typeof g.color === "string") return g.color;
  return "#6f8f9f"; // recipe_id 指定など色が無いとき
}

function mockRecipe(input: GenerateInputV5, color: string): RecipeV5 {
  const g = input.glaze && !("recipe_id" in input.glaze) ? input.glaze : {};
  const byRecipe = input.glaze && "recipe_id" in input.glaze ? input.glaze.recipe_id : null;
  // 色から決まる疑似的な焼成温度 (1200〜1280℃、10℃刻み)
  const n = parseInt(color.replace("#", "").slice(0, 2), 16) || 0;
  const temp = 1200 + Math.round((n / 255) * 8) * 10;
  const c = new THREE.Color(color);
  return {
    image_id: byRecipe ?? "00000000",
    soji: g.soji ?? "SojiToki",
    shosei: g.shosei ?? "ShouseiSanka",
    temp,
    hyomen: g.hyomen ?? "HyomenKotaku",
    yuseijo_a: g.yuseijo_a ?? "YuseijoAYusyokuTomei",
    yuseijo_b: g.yuseijo_b ?? "YuseijoBKinitsu",
    lab: [Math.round((c.r + c.g + c.b) / 3 * 100), Math.round((c.r - c.g) * 80), Math.round((c.g - c.b) * 80)],
    appearance_ja: "(疑似応答) 条件に近い釉薬",
    appearance_en: "(mock) glaze close to the request",
    glaze_types: [{ code: "A01", ja: "長石釉", en: "Feldspathic glaze" }],
    seger: {
      KNaO: 0.3, Li2O: 0, MgO: 0.05, CaO: 0.45, SrO: 0, BaO: 0, ZnO: 0.2, PbO: 0,
      Al2O3: 0.35, SiO2: 3.2, B2O3: 0.2,
    },
    formula: {
      base: "長石 40、石灰石 15、珪石 25、カオリン 10、フリット 10",
      additives: "酸化鉄 2",
      sections: [
        { label: "基礎釉", text: "長石 40、石灰石 15、珪石 25、カオリン 10、フリット 10" },
        { label: "添加物", text: "酸化鉄 2" },
      ],
      text: "基礎釉: 長石 40、石灰石 15、珪石 25、カオリン 10、フリット 10 / 添加物: 酸化鉄 2",
    },
    delta_e_to_color: byRecipe ? null : 6.5,
    relaxed: [],
    candidates: 12,
  };
}

async function buildV5Frames(input: GenerateInputV5, vessel: MockVessel): Promise<Frame[]> {
  const bad = unknownKeys(input, V5_KEYS);
  if (bad.length) {
    return valueError(`input に知らないキー ${JSON.stringify(bad)}。使えるキー = ${JSON.stringify(V5_KEYS)}`);
  }
  if (!input.depth_png && !input.depth_preset) return valueError("depth_png か depth_preset が必要です");
  if (input.preview) {
    const { every, size } = input.preview;
    if (!(every >= 1 && every <= 50) || !(size >= 64 && size <= 1024)) {
      return valueError("preview.every は 1〜50、preview.size は 64〜1024");
    }
  }

  const color = colorOf(input);
  const recipe = mockRecipe(input, color);
  await preloadVesselModel(vessel.shape);
  const photo = renderVesselPhoto(vessel, color, 1024, { background: "#e9e4dc" });

  const frames: Frame[] = [
    { at: 0, status: "IN_QUEUE" },
    { at: 0.9, status: "IN_PROGRESS", output: { stage: "recipe_selected", t: 0.1, recipe } satisfies ProgressV5 },
    { at: 1.5, status: "IN_PROGRESS", output: { stage: "generating", t: 0.7, recipe } satisfies ProgressV5 },
  ];

  const previews: PreviewFrameV5[] = [];
  if (input.preview) {
    const { every, size } = input.preview;
    const steps: number[] = [];
    for (let s = every; s <= GEN_STEPS; s += every) steps.push(s);
    const base = await loadImage(photo);
    steps.forEach((step, k) => {
      const at = PREVIEW_T0 + ((PREVIEW_T1 - PREVIEW_T0) * k) / Math.max(1, steps.length - 1);
      const image = blurredPreview(base, size, 1 - step / GEN_STEPS);
      previews.push({ step, t: at - 0.4, image });
      frames.push({
        at,
        status: "IN_PROGRESS",
        output: { stage: "generating", t: at - 0.4, recipe, preview: { step, steps: GEN_STEPS, image } } satisfies ProgressV5,
      });
    });
  }

  const output: GenerateOutputV5 = {
    prompt_used: "(mock) a ceramic vessel on a windowsill",
    images: [{ url: photo, seed: input.gen_params?.seed ?? 42, elapsed_sec: V5_DONE_T - 1 }],
    recipe,
    timeline: [
      { stage: "recipe_selected", t: 0.1 },
      { stage: "generating", t: 0.7 },
      { stage: "image_done", t: V5_DONE_T - 1, index: 0 },
    ],
    meta: { backend: "mock", scene: input.scene ?? "window" },
  };
  if (input.preview) output.previews = previews;
  frames.push({ at: V5_DONE_T, status: "COMPLETED", output });
  return frames;
}

// ---- 3D ----

async function build3DFrames(input: GenerateInput3D, vessel: MockVessel): Promise<Frame[]> {
  const bad = unknownKeys(input, D3_KEYS);
  if (bad.length) {
    return valueError(`input に知らないキー ${JSON.stringify(bad)}。使えるキー = ${JSON.stringify(D3_KEYS)}`);
  }
  if (typeof input.image !== "string" || !input.image.startsWith("data:image/")) {
    return valueError("image は data URL で渡してください");
  }
  if (input.detail !== undefined && typeof input.detail !== "boolean") {
    return valueError("detail は true / false");
  }

  // 本物は画像から形と色を推定する。モックは器の形と、画像の中央付近の色を使う
  const color = await dominantColor(input.image);
  await preloadVesselModel(vessel.shape);
  const frames: Frame[] = [{ at: 0, status: "IN_QUEUE" }];
  const at = (t: number) => D3_QUEUE_T + t;

  if (!input.detail) {
    frames.push({ at: at(0.1), status: "IN_PROGRESS", output: { stage: "generating", t: 0.1 } satisfies Progress3D });
    const glb = await exportVesselGlb(vessel, color);
    frames.push({
      at: at(D3_DONE_PLAIN_T),
      status: "COMPLETED",
      output: { glb, meta: { quality: input.quality ?? "standard", seed: input.seed ?? 42, gen_sec: 13.3, glb_sec: 9.7 } } satisfies GenerateOutput3D,
    });
    return frames;
  }

  const cutout = renderVesselPhoto(vessel, color, 384, { background: "#ffffff", jpeg: true });
  const coarse = sampleVesselPoints(vessel, 32, 1760, null);
  const fine = sampleVesselPoints(vessel, 64, 6000, null);
  const colored = sampleVesselPoints(vessel, 1024, 8000, color);
  const faces = 19907;
  const [glb, shapeGlb] = await Promise.all([
    exportVesselGlb(vessel, color),
    exportVesselGlb(vessel, "#b8b4ad"),
  ]);

  const stageOutput: Record<string, Progress3D> = {
    ready: { stage: "ready", t: 0.1 },
    cutout: { stage: "cutout", t: 1.2, image: cutout },
    coarse_shape: { stage: "coarse_shape", t: 4.8, res: 32, points: coarse },
    fine_shape: { stage: "fine_shape", t: 12.3, res: 64, points: fine },
    shape_mesh: { stage: "shape_mesh", t: 13.2, faces },
    texture_latent: { stage: "texture_latent", t: 16.0 },
    color_points: { stage: "color_points", t: 17.3, points: colored },
  };
  for (const [stage, t] of D3_STAGES) {
    frames.push({ at: at(t), status: "IN_PROGRESS", output: stageOutput[stage] });
  }
  const output: GenerateOutput3D = {
    glb,
    meta: { quality: input.quality ?? "standard", seed: input.seed ?? 42, gen_sec: 17.2, glb_sec: 16.3 },
    detail: {
      cutout: { t: 1.2, image: cutout },
      coarse_shape: { t: 4.8, res: 32, points: coarse },
      fine_shape: { t: 12.3, res: 64, points: fine },
      shape_mesh: { t: 13.2, faces, glb: shapeGlb },
      texture_latent: { t: 16.0 },
      color_points: { t: 17.3, points: colored },
    },
    timeline: [...D3_STAGES.map(([stage, t]) => ({ stage, t })), { stage: "glb", t: D3_DONE_DETAIL_T }],
  };
  frames.push({ at: at(D3_DONE_DETAIL_T), status: "COMPLETED", output });
  return frames;
}

// ---- 素材づくり (three.js / canvas) ----

/** 器を釉薬の色で描いた写真風の絵 (data URL)。WebGL のリソースは描画後に破棄する */
function renderVesselPhoto(
  vessel: MockVessel,
  color: string,
  size: number,
  opts: { background: string; jpeg?: boolean }
): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(new THREE.Color(opts.background), 1);

  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });
  const scene = new THREE.Scene();
  const angle = vessel.angle ?? DEFAULT_CAPTURE_ANGLE;
  const group = buildVesselGroup(vessel.shape, vessel.custom, material, captureZoom(angle), angle.yaw);
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-3, 2, -3);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(DEPTH_CAMERA.fov, 1, 0.1, 100);
  camera.position.set(...captureCameraPosition(angle.pitch));
  camera.lookAt(0, 0, 0);

  try {
    renderer.render(scene, camera);
    return opts.jpeg ? canvas.toDataURL("image/jpeg", 0.85) : canvas.toDataURL("image/png");
  } finally {
    disposeGroup(group);
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("mock: image load failed"));
    img.src = src;
  });
}

/** 完成予想の途中の絵: amount (1 → 0) に応じてぼかす。JPEG data URL */
function blurredPreview(base: HTMLImageElement, size: number, amount: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return base.src;
  const blur = Math.round(amount * amount * (size / 12));
  ctx.filter = blur > 0 ? `blur(${blur}px) saturate(${Math.round(100 - amount * 60)}%)` : "none";
  ctx.drawImage(base, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** 画像の中央付近の平均色 (3D のモックが「画像から色を拾った」ことにする) */
async function dominantColor(src: string): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#8a8a8a";
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(5, 5, 6, 6).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return `#${new THREE.Color(r / n / 255, g / n / 255, b / n / 255).getHexString()}`;
}

/**
 * 器の表面から点を採り、res³ の格子座標 (整数、z が上) に落とす。
 * color を渡すと法線で陰影をつけた rgb も返す
 */
function sampleVesselPoints(
  vessel: MockVessel,
  res: number,
  max: number,
  color: string | null
): Points3D {
  const material = new THREE.MeshBasicMaterial();
  const group = buildVesselGroup(vessel.shape, vessel.custom, material, 1);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) || 1;
  const center = box.getCenter(new THREE.Vector3());
  const base = new THREE.Color(color ?? "#ffffff");
  const light = new THREE.Vector3(0.4, 0.8, 0.45).normalize();

  const cells = new Map<string, [number, number, number, number]>(); // key → x,y,z,shade
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const perMesh = Math.ceil(max * 4);
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const sampler = new MeshSurfaceSampler(o).build();
    normalMatrix.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < perMesh; i++) {
      sampler.sample(pos, nrm);
      pos.applyMatrix4(o.matrixWorld);
      nrm.applyMatrix3(normalMatrix).normalize();
      // three (y が上) → 格子 (z が上): (X, Y, Z) → (X, -Z, Y)
      const gx = Math.round(((pos.x - center.x) / extent + 0.5) * (res - 1));
      const gy = Math.round(((-pos.z + center.z) / extent + 0.5) * (res - 1));
      const gz = Math.round(((pos.y - center.y) / extent + 0.5) * (res - 1));
      const key = `${gx},${gy},${gz}`;
      if (!cells.has(key)) {
        cells.set(key, [gx, gy, gz, 0.55 + 0.45 * Math.max(0, Math.abs(nrm.dot(light)))]);
      }
    }
  });
  disposeGroup(group);
  material.dispose();

  const all = [...cells.values()];
  const nTotal = all.length;
  // 間引き (決定的に、等間隔で)
  const picked = all.length > max ? all.filter((_, i) => Math.floor((i * max) / all.length) !== Math.floor(((i - 1) * max) / all.length)) : all;
  const points: Points3D = { n_total: nTotal, xyz: picked.map(([x, y, z]) => [x, y, z]) };
  if (color) {
    points.rgb = picked.map(([, , , shade]) => [
      Math.round(base.r * shade * 255),
      Math.round(base.g * shade * 255),
      Math.round(base.b * shade * 255),
    ]);
  }
  return points;
}

/** 器のメッシュを GLB (data URL) に書き出す。y が上のまま (本物の完成 GLB と同じ向き) */
async function exportVesselGlb(vessel: MockVessel, color: string): Promise<string> {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });
  const group = buildVesselGroup(vessel.shape, vessel.custom, material, 1);
  try {
    const data = await new GLTFExporter().parseAsync(group, { binary: true });
    const blob = new Blob([data as ArrayBuffer], { type: "model/gltf-binary" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } finally {
    disposeGroup(group);
    material.dispose();
  }
}
