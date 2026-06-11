import type { Hsl } from "./colors";

export type Additive = { key: string; val: string };

// 色相・彩度・明度から想定される着色添加物を概算する
export function additivesForColor(hsl: Hsl): Additive[] {
  const { h, s, l } = hsl;
  const additives: Additive[] = [];

  if (l > 82) {
    additives.push({ key: "珪酸ジルコニウム (乳濁剤)", val: "8.0%" });
    additives.push({ key: "酸化錫 (失透用)", val: "1.5%" });
  } else if (l < 18) {
    additives.push({ key: "酸化鉄 (黒マンガン土)", val: "6.5%" });
    additives.push({ key: "酸化コバルト (黒色用)", val: "1.0%" });
    additives.push({ key: "二酸化マンガン", val: "2.0%" });
  } else {
    if (h >= 340 || h < 20) {
      if (s > 40) {
        additives.push({ key: "酸化鉄 (辰砂/鉄赤用)", val: "5.5%" });
        additives.push({ key: "骨灰 (乳濁補助)", val: "1.5%" });
      } else {
        additives.push({ key: "炭酸銅 (還元銅赤用)", val: "1.2%" });
        additives.push({ key: "酸化錫 (還元助剤)", val: "1.0%" });
      }
    } else if (h >= 20 && h < 55) {
      additives.push({ key: "黄土 (生鉄原料)", val: "4.0%" });
      additives.push({ key: "酸化鉄 (弁柄)", val: "1.8%" });
      if (s > 50) additives.push({ key: "二酸化マンガン (黒茶色用)", val: "0.8%" });
    } else if (h >= 55 && h < 85) {
      additives.push({ key: "酸化鉄 (調色用)", val: "1.5%" });
      additives.push({ key: "炭酸銅", val: "0.8%" });
    } else if (h >= 85 && h < 165) {
      additives.push({ key: "炭酸銅 (銅緑釉用)", val: "2.5%" });
      additives.push({ key: "酸化マンガン (調色用)", val: "0.4%" });
      if (s > 60) additives.push({ key: "酸化クロム (深緑用)", val: "1.0%" });
    } else if (h >= 165 && h < 205) {
      additives.push({ key: "酸化鉄 (青磁鉄分)", val: "1.2%" });
      if (s > 35) additives.push({ key: "炭酸銅 (Celadon)", val: "0.4%" });
    } else if (h >= 205 && h < 265) {
      additives.push({ key: "酸化コバルト (瑠璃釉用)", val: "0.8%" });
      if (s > 50) additives.push({ key: "炭酸銅", val: "0.3%" });
      additives.push({ key: "酸化チタン (結晶助剤)", val: "0.5%" });
    } else if (h >= 265 && h < 340) {
      additives.push({ key: "二酸化マンガン (紫釉用)", val: "3.0%" });
      additives.push({ key: "酸化コバルト (青調用)", val: "0.3%" });
      additives.push({ key: "炭酸銅", val: "0.4%" });
    }
  }

  if (additives.length === 0) {
    additives.push({ key: "無添加 (透明釉ベース)", val: "-" });
  }
  return additives;
}

export function thicknessDesc(v: number): string {
  if (v < 25) return "薄掛け";
  if (v < 45) return "標準〜やや薄掛け";
  if (v > 75) return "厚掛け";
  if (v > 55) return "標準〜やや厚掛け";
  return "標準";
}
