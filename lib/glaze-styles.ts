// Step-2B「釉薬スタイルから選ぶ」の選択肢。
// コード (A01..G12) は釉薬データベース MainTable の「釉名称」列の値で、
// 頭文字がカテゴリ、番号が仕様表 (GLAIZ_Flow step-2B, 2026-10-15 共有) の行順。
// 表記 (en/ja) は仕様表のまま。
//
// ⚠ 仮置き: コード→名称の対応表はデータベースに同梱されていない。
// 件数とコメント列の突き合わせで行順 = 番号と判断した (C13=海鼠, D02=鈞窯, D05=トルコ青, E04=ジオプサイトなど)。
// 基礎釉だけはデータに A20 が無く A21 まであるため、A19〜A21 は要確認 (岸さんに照会中)。

export type GlazeCategoryKey =
  | "base"
  | "white"
  | "iron"
  | "copper"
  | "crystalline"
  | "colored"
  | "colorName";

export type GlazeStyle = {
  code: string;
  category: GlazeCategoryKey;
  en: string;
  ja: string;
};

export type GlazeCategory = {
  key: GlazeCategoryKey;
  en: string;
  ja: string;
  styles: GlazeStyle[];
};

function cat(
  key: GlazeCategoryKey,
  en: string,
  ja: string,
  prefix: string,
  names: [string, string][],
  numbers?: number[]
): GlazeCategory {
  const styles = names.map(([n, j], i) => ({
    code: `${prefix}${String(numbers ? numbers[i] : i + 1).padStart(2, "0")}`,
    category: key,
    en: n,
    ja: j,
  }));
  return { key, en, ja, styles };
}

export const GLAZE_CATEGORIES: GlazeCategory[] = [
  cat(
    "base",
    "Base Glaze",
    "基礎釉",
    "A",
    [
      ["Feldspathic glaze", "長石釉"],
      ["Lime glaze", "石灰釉"],
      ["Talc glaze", "タルク釉"],
      ["Dolomite glaze", "ドロマイト釉"],
      ["Zinc glaze", "亜鉛釉"],
      ["Barium glaze", "バリウム釉"],
      ["Strontium glaze", "ストロンチウム釉"],
      ["Magnesia glaze", "マグネシア釉"],
      ["Lead glaze", "鉛釉"],
      ["Lead borate glaze", "硼酸鉛釉"],
      ["Lead-free borate glaze", "無鉛硼酸釉"],
      ["Colemanite (ulexite) glaze", "コレマナイト（ユーレキサイト）釉"],
      ["Lithium glaze", "リチウム釉"],
      ["Alkaline glaze", "アルカリ釉"],
      ["Ash glaze", "灰釉"],
      ["Rice straw ash glaze, Rice husk ash glaze", "藁灰釉、もみがら灰釉"],
      ["Salt glaze", "食塩釉"],
      ["Non ash glaze", "土石釉"],
      ["Frit glaze", "フリット釉"],
      ["Porcelain stone glaze", "陶石釉"],
    ],
    // データに A20 が存在しないため、最後の 1 件を A21 に当てている (要確認)
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21]
  ),
  cat("white", "White Glazes", "白系", "B", [
    ["Transparent glaze", "透明釉"],
    ["Isu ash glaze / Isubai-yu", "柞灰釉"],
    ["Shino glaze", "志野釉"],
    ["Sharkskin glaze / Samehada-yu", "鮫肌釉"],
    ["Crackle glaze", "貫入釉"],
    ["Milky opaque glaze", "乳濁釉"],
    ["White Hagi glaze / Shirahagi-yu", "白萩釉"],
    ["White matte glaze", "白マット釉"],
    ["Matte glaze", "マット釉"],
  ]),
  cat("iron", "Iron-based", "鉄系", "C", [
    ["Irabo glaze", "伊羅保釉"],
    ["Kiseto(Kizeto) glaze", "黄瀬戸釉"],
    ["Koseto(Kozeto) glaze / Koseto(Kozeto)-yu", "古瀬戸釉"],
    ["Setoguro glaze", "瀬戸黒釉"],
    ["Tenmoku glaze", "天目釉"],
    ["Amber glaze / Ame-yu", "飴釉"],
    ["Persimmon glaze / Kaki-yu", "柿釉"],
    ["Buckwheat-colored glaze / Soba-yu", "蕎麦釉"],
    ["Tessha glaze / Tessha-yu", "鉄砂釉"],
    ["Iron red glaze", "鉄赤釉"],
    ["Red mottled glaze / Shuhan-yu", "朱斑釉"],
    ["Iron black glaze / Koku-yu", "黒釉"],
    ["Namako glaze", "海鼠釉"],
    ["Celadon glaze", "青磁釉"],
    ["Iron glaze", "鉄釉"],
  ]),
  cat("copper", "Copper-based", "銅系", "D", [
    ["Shinsha glaze / Shinsha-yu", "辰砂釉"],
    ["Jun glaze / Kinyo-yu", "鈞窯釉"],
    ["Moon-white glaze / Geppaku-yu", "月白釉"],
    ["Oribe glaze", "織部釉"],
    ["Turquoise blue glaze", "トルコ青釉"],
    ["Copper celadon glaze", "銅青磁釉"],
    ["Copper-green glaze / Ryoku-yu", "緑釉"],
    ["Copper-red glaze", "銅赤釉"],
  ]),
  cat("crystalline", "Crystalline", "結晶系", "E", [
    ["Aventurine glaze", "アベンチュリン釉"],
    ["Vermilion-gold crystalline glaze / Shukinji-yu", "朱金地釉"],
    ["Manganese crystalline glaze", "マンガン結晶釉"],
    ["Diopside crystalline glaze", "ジオプサイト結晶釉"],
    ["Titanium crystalline glaze", "チタン結晶釉"],
    ["Zinc crystalline glaze", "亜鉛結晶釉"],
    ["Straw ash opaque glaze", "藁灰失透釉"],
    ["Cobalt crystalline glaze", "コバルト結晶釉"],
    ["Cobalt titanium crystalline glaze", "コバルトチタン結晶釉"],
    ["Opal luster glaze", "オパールラスター釉"],
    ["Manganese luster glaze", "マンガンラスター釉"],
  ]),
  cat("colored", "Colored Glaze", "色釉", "F", [
    ["Cobalt blue glaze / Ruri-yu", "瑠璃釉"],
    ["Nickel blue glaze", "ニッケル青釉"],
  ]),
  cat("colorName", "Color Name", "色名称", "G", [
    ["Yellow glaze", "黄色釉"],
    ["Green glaze", "緑色釉"],
    ["Gray glaze", "鼠色釉"],
    ["Brown glaze", "茶色釉"],
    ["Purple glaze", "紫色釉"],
    ["Orange glaze", "橙色釉"],
    ["Black glaze", "黒色釉"],
    ["Red glaze", "赤色釉"],
    ["Blue glaze", "青色釉"],
    ["Tan glaze", "褐色釉"],
    ["White glaze", "白色釉"],
    ["Pink glaze", "桃色釉"],
  ]),
];

export const GLAZE_STYLES: GlazeStyle[] = GLAZE_CATEGORIES.flatMap((c) => c.styles);

const BY_CODE = new Map(GLAZE_STYLES.map((s) => [s.code, s]));

export function glazeStyleByCode(code: string): GlazeStyle | undefined {
  return BY_CODE.get(code);
}
