// UI 文言の英日切替。選択値そのもの（焼成リクエストに載る日本語）は変えず、表示ラベルだけを切り替える
export type Lang = "en" | "ja";

// value は状態・API に使う日本語の正本、en は英語表示用のラベル
export type Choice = { value: string; en: string };

export const EXPRESSIONS: Choice[] = [
  { value: "なめらか", en: "Smooth" },
  { value: "ざらつき", en: "Rough" },
  { value: "流れ", en: "Flow" },
  { value: "斑点", en: "Speckled" },
  { value: "貫入", en: "Crazing" },
  { value: "結晶", en: "Crystalline" },
];

export const STYLE_NAMES: Choice[] = [
  { value: "志野釉", en: "Shino" },
  { value: "織部釉", en: "Oribe" },
  { value: "天目釉", en: "Tenmoku" },
  { value: "青磁釉", en: "Celadon" },
  { value: "黄瀬戸釉", en: "Ki-Seto" },
  { value: "瀬戸黒釉", en: "Seto-Guro" },
  { value: "辰砂釉", en: "Shinsha" },
  { value: "白萩釉", en: "Shirahagi" },
  { value: "海鼠釉", en: "Namako" },
  { value: "鈞窯釉", en: "Jun" },
  { value: "月白釉", en: "Geppaku" },
  { value: "伊羅保釉", en: "Iraho" },
];

export const STYLE_COLORS: Choice[] = [
  { value: "瑠璃釉", en: "Lapis" },
  { value: "トルコ青釉", en: "Turkish Blue" },
  { value: "銅赤釉", en: "Copper Red" },
  { value: "銅青磁釉", en: "Copper Celadon" },
  { value: "鉄釉", en: "Iron" },
  { value: "柿釉", en: "Kaki" },
  { value: "黒釉", en: "Black" },
  { value: "鉄赤釉", en: "Iron Red" },
  { value: "緑釉", en: "Green" },
];

export const STYLE_TEXTURES: Choice[] = [
  { value: "透明釉", en: "Transparent" },
  { value: "乳濁釉", en: "Opaque" },
  { value: "マット釉", en: "Matte" },
  { value: "貫入釉", en: "Crackle" },
  { value: "結晶釉", en: "Crystalline" },
  { value: "ラスター釉", en: "Luster" },
];

export function choiceLabel(c: Choice, lang: Lang): string {
  return lang === "en" ? c.en : c.value;
}

const en = {
  about: "ABOUT",
  archive: "ARCHIVE",
  share: "SHARE",
  start: "Start",

  form: "FORM",
  clayBody: "CLAY BODY",
  atmosphere: "ATMOSPHERE",
  next: "NEXT",
  back: "BACK",
  fire: "FIRE",
  adjust: "ADJUST",

  shapes: {
    vase: "VASE",
    haniwa: "HANIWA",
    plate: "PLATE",
    handbag: "HANDBAG",
    teapot: "TEAPOT",
    flower: "FLOWER",
    mug: "MUG",
    cat: "CAT",
    surprise: "SURPRISE",
    wheel: "Wheel",
  },
  clays: {
    "stoneware-white": "Stoneware/White",
    "stoneware-red": "Stoneware/Red",
    porcelain: "Porcelain",
  },
  oxidation: "Oxidation",
  reduction: "Reduction",

  drawHint: "Draw a single line from base to rim.",
  drawTooShort: "The line is too short. Draw a longer one.",

  color: "COLOR",
  colorWheel: "Color Wheel",
  hslSliders: "HSL Sliders",
  wheelFilters: { all: "All", light: "Light", medium: "Mid", dark: "Dark" },
  hue: "Hue",
  saturation: "Saturation",
  lightness: "Lightness",
  glazeStyle: "GLAZE STYLE",
  styleName: "Tradition",
  styleColor: "Color",
  styleTexture: "Finish",
  withWords: "WITH WORDS",
  moodPlaceholder: "e.g. A forest after rain, quiet and a little damp...",

  surfaceEffect: "Surface Effect",
  transparency: "Transparency",
  gloss: "Gloss",

  firing: "FIRING...",
  phases: {
    submitting: "Submitting the firing job...",
    queued: "Waiting in the kiln queue. A cold kiln takes 2-3 min.",
    running: "Firing. About 15 sec.",
  },
  fireFailed: "Firing failed",
  fireConfig:
    "The generation API is not configured. Showing the selected glaze as a flat color.",
  retry: "RETRY",

  suggestedRecipe: "Suggested Recipe",
  disclaimer: "For reference only. Actual results may vary.",
  rotateLeft: "Rotate left",
  rotateRight: "Rotate right",

  adjustRows: {
    tone: "Tone",
    gloss: "Gloss",
    flow: "Flow",
    crackle: "Crackle",
    temp: "Temperature",
    thickness: "Thickness",
  },

  aboutHeading: [
    "Visualizing the Beauty of Glaze with AI.",
    "Another Way to Experience Ceramics.",
  ],
  aboutBody: [
    "Ceramics is a timeless technology that transforms clay, glaze, and fire into unexpected beauty through chemical reactions.",
    "GLAIZ is a project that brings together a vast archive of glaze data from Japan's pottery industry and cutting-edge AI technology. By visualizing the world of glazes, traditionally shaped by artisans' experience and intuition, we aim to create another way to experience ceramics—one that invites anyone to freely explore new creative possibilities.",
    "We hope this experiment will open up new possibilities for the future of ceramic culture and spark unexpected new reactions.",
  ],
};

export type Strings = typeof en;

const ja: Strings = {
  about: "ABOUT",
  archive: "ARCHIVE",
  share: "SHARE",
  start: "はじめる",

  form: "形",
  clayBody: "素地",
  atmosphere: "焼成雰囲気",
  next: "次へ",
  back: "戻る",
  fire: "焼成する",
  adjust: "調整する",

  shapes: {
    vase: "花瓶",
    haniwa: "埴輪",
    plate: "皿",
    handbag: "ハンドバッグ",
    teapot: "急須",
    flower: "花",
    mug: "マグカップ",
    cat: "招き猫",
    surprise: "おまかせ",
    wheel: "一筆描き",
  },
  clays: {
    "stoneware-white": "陶器（白土）",
    "stoneware-red": "陶器（赤土）",
    porcelain: "磁器",
  },
  oxidation: "酸化焼成",
  reduction: "還元焼成",

  drawHint: "底から口へ向かって、器の輪郭を一筆で描いてください。",
  drawTooShort: "線が短すぎます。もう少し長く描いてください",

  color: "色",
  colorWheel: "色相環",
  hslSliders: "HSLスライダー",
  wheelFilters: { all: "すべて", light: "明るめ", medium: "中間", dark: "暗め" },
  hue: "色相",
  saturation: "彩度",
  lightness: "明度",
  glazeStyle: "釉薬スタイル",
  styleName: "伝統名称",
  styleColor: "色や発色",
  styleTexture: "仕上がりの質感",
  withWords: "言葉でつくる",
  moodPlaceholder: "例：雨上がりの森みたいな、静かで少し湿った感じ…",

  surfaceEffect: "表情",
  transparency: "透明度",
  gloss: "光沢度",

  firing: "焼成中...",
  phases: {
    submitting: "焼成ジョブを投入中…",
    queued: "窯の順番待ち… 窯が冷えていると 2〜3 分かかります",
    running: "焼成中… 目安 15 秒前後",
  },
  fireFailed: "焼成に失敗しました",
  fireConfig:
    "本番生成 API が未設定のため、選択中の釉薬色を単色で表示しています",
  retry: "もう一度焼成する",

  suggestedRecipe: "Suggested Recipe",
  disclaimer: "参考値です。実際の焼き上がりとは異なる場合があります。",
  rotateLeft: "左に回す",
  rotateRight: "右に回す",

  adjustRows: {
    tone: "色の濃さ",
    gloss: "光沢",
    flow: "流れの強さ",
    crackle: "貫入の細かさ",
    temp: "焼成温度",
    thickness: "施釉の厚み",
  },

  // 仮訳。確定コピーが決まったら差し替える
  aboutHeading: [
    "釉薬の美しさを、AIで可視化する。",
    "やきものの、もうひとつの楽しみ方。",
  ],
  aboutBody: [
    "やきものは、土と釉薬と炎が化学反応によって思いがけない美しさへと変わる、時代を超えた技術です。",
    "GLAIZは、日本の窯業界に蓄積された膨大な釉薬データと、最先端のAI技術をかけあわせるプロジェクトです。これまで職人の経験と勘によって形づくられてきた釉薬の世界を可視化することで、誰もが自由に新しい創造の可能性を探れる、やきもののもうひとつの楽しみ方をつくることを目指しています。",
    "この試みが、陶磁文化の未来に新たな可能性をひらき、思いがけない新しい反応を生み出すことを願っています。",
  ],
};

export const STRINGS: Record<Lang, Strings> = { en, ja };
