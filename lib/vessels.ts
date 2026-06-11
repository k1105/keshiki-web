export type ShapeKey =
  | "vase"
  | "mug"
  | "plate"
  | "teapot"
  | "yunomi"
  | "bowl";

export type ShapeOption = {
  key: ShapeKey | "random";
  name: string;
};

export const SHAPE_OPTIONS: ShapeOption[] = [
  { key: "vase", name: "花瓶" },
  { key: "mug", name: "マグカップ" },
  { key: "plate", name: "高台皿" },
  { key: "teapot", name: "急須" },
  { key: "yunomi", name: "湯呑" },
  { key: "bowl", name: "鉢" },
  { key: "random", name: "おまかせ" },
];

export const CONCRETE_SHAPES: ShapeKey[] = [
  "vase",
  "mug",
  "plate",
  "teapot",
  "yunomi",
  "bowl",
];

// 回転体の断面プロファイル（x = 半径, y = 高さ）。smooth はスプライン補間の有無。
export type VesselSpec = {
  profile: [number, number][];
  smooth: boolean;
  height: number; // プロファイル全体の高さ（センタリング用）
  scale: number; // 形ごとの見た目サイズ調整
};

// 一筆描きから生成した回転体プロファイル（正規化済み）
export type CustomVessel = {
  profile: [number, number][];
  height: number;
};

export type VesselShape = ShapeKey | "custom";

export function resolveVesselSpec(
  shape: VesselShape,
  custom?: CustomVessel | null
): VesselSpec {
  if (shape === "custom") {
    if (custom) {
      return {
        profile: custom.profile,
        smooth: true,
        height: custom.height,
        scale: 1,
      };
    }
    return VESSEL_SPECS.vase;
  }
  return VESSEL_SPECS[shape];
}

export const VESSEL_SPECS: Record<ShapeKey, VesselSpec> = {
  vase: {
    profile: [
      [0, 0],
      [0.5, 0],
      [0.78, 0.12],
      [0.95, 0.5],
      [0.97, 0.85],
      [0.85, 1.2],
      [0.55, 1.5],
      [0.4, 1.65],
      [0.36, 1.95],
      [0.37, 2.15],
      [0.44, 2.3],
    ],
    smooth: true,
    height: 2.3,
    scale: 1.0,
  },
  mug: {
    profile: [
      [0, 0],
      [0.62, 0],
      [0.7, 0.08],
      [0.72, 0.2],
      [0.74, 1.5],
    ],
    smooth: false,
    height: 1.5,
    scale: 1.05,
  },
  plate: {
    profile: [
      [0, 0.28],
      [0.55, 0.32],
      [1.0, 0.42],
      [1.3, 0.58],
      [1.4, 0.66],
    ],
    smooth: true,
    height: 0.66,
    scale: 0.95,
  },
  teapot: {
    profile: [
      [0, 0],
      [0.55, 0.02],
      [0.85, 0.25],
      [1.0, 0.6],
      [0.95, 0.95],
      [0.7, 1.2],
      [0.42, 1.3],
    ],
    smooth: true,
    height: 1.45,
    scale: 1.0,
  },
  yunomi: {
    profile: [
      [0, 0],
      [0.5, 0],
      [0.56, 0.06],
      [0.66, 1.22],
      [0.7, 1.3],
    ],
    smooth: false,
    height: 1.3,
    scale: 1.2,
  },
  bowl: {
    profile: [
      [0, 0.1],
      [0.32, 0.12],
      [0.55, 0.25],
      [0.92, 0.55],
      [1.12, 0.88],
      [1.16, 1.0],
    ],
    smooth: true,
    height: 1.0,
    scale: 1.1,
  },
};

export function nameToShape(name: string): ShapeKey | "random" {
  const found = SHAPE_OPTIONS.find((s) => s.name === name);
  return found ? found.key : "vase";
}

export function shapeToName(key: ShapeKey): string {
  const found = SHAPE_OPTIONS.find((s) => s.key === key);
  return found ? found.name : "花瓶";
}
