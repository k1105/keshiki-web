// 素地（釉薬をかける前の生地）の定義。プレビューは素焼き状態を単色で表示する
export type ClayKey = "porcelain" | "stoneware-white" | "stoneware-red";

export type ClayBody = {
  key: ClayKey;
  name: string;
  hex: string; // 素焼き後の素地色
  desc: string;
};

export const CLAY_BODIES: ClayBody[] = [
  {
    key: "porcelain",
    name: "磁器",
    hex: "#f2f0eb",
    desc: "1280℃以上で焼成。緻密で透光性あり。",
  },
  {
    key: "stoneware-white",
    name: "陶器（白土）",
    hex: "#e2d8c3",
    desc: "1200℃前後で焼成。明るく釉薬の色が出やすい。",
  },
  {
    key: "stoneware-red",
    name: "陶器（赤土）",
    hex: "#a5603c",
    desc: "1200℃前後で焼成。鉄分が多く、素朴で温かい印象。",
  },
];

export function clayByKey(key: ClayKey): ClayBody {
  return CLAY_BODIES.find((c) => c.key === key) ?? CLAY_BODIES[1];
}
