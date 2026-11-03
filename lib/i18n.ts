// UI 文言の英日切替。選択値そのもの（焼成リクエストに載る値）は変えず、表示ラベルだけを切り替える
import type { Hyomen, YuseijoA, YuseijoB } from "./generate_v5";

export type Lang = "en" | "ja";

const en = {
  about: "ABOUT",
  archive: "ARCHIVE",
  share: "SHARE",
  start: "Start",

  selectBase: "Select the Base",
  form: "FORM",
  clayBody: "CLAY BODY",
  atmosphere: "ATMOSPHERE",
  next: "NEXT",
  back: "BACK",
  fire: "FIRE",

  shapes: {
    vase: "VASE",
    haniwa: "HANIWA",
    plate: "PLATE",
    handbag: "HANDBAG",
    teapot: "TEAPOT",
    flower: "FLOWER",
    mug: "MUG",
    cat: "CAT",
    surprise: "CUSTOM",
    wheel: "Wheel",
  },
  clays: {
    "stoneware-white": "Earthenware",
    "stoneware-red": "Red clay",
    porcelain: "Porcelain",
  },
  oxidation: "Oxidation",
  reduction: "Reduction",

  drawHint: "Draw a single line from base to rim.",
  drawTooShort: "The line is too short. Draw a longer one.",

  selectLook: "Select the Look",
  appearance: "APPEARANCE",
  glazeHeading: "GLAZE",
  inspiration: "INSPIRATION",

  color: "COLOR",
  colorWheel: "Color Wheel",
  hslSliders: "HSL Sliders",
  wheelFilters: { all: "All", light: "Light", medium: "Mid", dark: "Dark" },
  hue: "Hue",
  saturation: "Saturation",
  lightness: "Lightness",
  surface: "SURFACE",
  transparency: "TRANSPARENCY",
  character: "CHARACTER",
  hyomen: {
    HyomenKotaku: "Glossy",
    HyomenHanKotaku: "Semi-gloss",
    HyomenTsuyakeshi: "Matte",
  } as Record<Hyomen, string>,
  yuseijoA: {
    YuseijoAMFutoumei: "Opaque",
    YuseijoAYusyokuTomei: "Tinted clear",
    YuseijoAMushokuTomei: "Colorless clear",
  } as Record<YuseijoA, string>,
  yuseijoB: {
    YuseijoBKinitsu: "Uniform",
    YuseijoBFukinnitsu: "Mottled",
    YuseijoBKessho: "Crystalline",
    YuseijoBKannyu: "Crackle",
    YuseijoBLuster: "Luster",
  } as Record<YuseijoB, string>,
  glazeHint: "Pick any glazes you like. Greyed ones have no data together with your picks, but can still be chosen.",
  glazeSelected: "selected",
  glazeNone: "Not chosen yet",
  glazeOpen: "Choose",
  glazeChange: "Change",
  glazeModalTitle: "GLAZE",
  glazeCandidates: "Combinations in the database",
  glazeCandidatesAll: "Pick a glaze on the left to narrow these down.",
  glazeCandidatesNear: "No combination contains all of your picks. Closest ones:",
  glazeCandidatesEmpty: "No combination with these glazes for this clay and atmosphere.",
  glazeCount: (n: number) => `${n} ${n === 1 ? "recipe" : "recipes"}`,
  glazeMore: (n: number) => `${n} more. Pick more glazes to narrow down.`,
  glazeConfirm: "CONFIRM",
  glazeClose: "CLOSE",
  glazeLoading: "Loading the database...",
  moodPlaceholder: "e.g. A forest after rain, quiet and a little damp...",

  firing: "FIRING...",
  phases: {
    submitting: "Submitting the firing job...",
    queued: "Waiting in the kiln queue. A cold kiln takes 2-3 min.",
    running: "Firing. About 30 sec.",
    submitting3d: "Fired. Preparing the 3D kiln...",
    queued3d: "Waiting for the 3D kiln. A cold kiln takes a few minutes.",
    running3d: "Shaping in 3D. About 30 sec.",
  },
  stages3d: {
    loading: "Loading the model...",
    ready: "Ready",
    cutout: "Cutting out the vessel",
    coarse_shape: "Rough shape",
    fine_shape: "Fine shape",
    shape_mesh: "Surface",
    texture_latent: "Texture",
    color_points: "Coloring",
  },
  retry3d: "RETRY 3D ONLY",
  fireFailed: "Firing failed",
  fireTimeout: "The kiln did not respond within 15 minutes. Please try again.",
  fireConfig:
    "The generation API is not configured. Showing the selected glaze as a flat color.",
  retry: "RETRY",

  suggestedRecipe: "Estimated Recipe",
  disclaimer:
    "A reference recipe close to the generated result. It does not guarantee actual firing results.",
  colorFar: "No glaze close to this color exists for this clay and atmosphere. Showing the nearest one.",
  rotateLeft: "Rotate left",
  rotateRight: "Rotate right",

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

  selectBase: "ベースを選ぶ",
  form: "かたち",
  clayBody: "素地",
  atmosphere: "焼成雰囲気",
  next: "次へ",
  back: "戻る",
  fire: "焼成する",

  shapes: {
    vase: "壺",
    haniwa: "埴輪",
    plate: "皿",
    handbag: "バッグ",
    teapot: "急須",
    flower: "花",
    mug: "マグ",
    cat: "猫",
    surprise: "自分でつくる",
    wheel: "一筆描き",
  },
  clays: {
    "stoneware-white": "陶器/白",
    "stoneware-red": "陶器/赤",
    porcelain: "磁器",
  },
  oxidation: "酸化焼成",
  reduction: "還元焼成",

  drawHint: "底から口へ向かって、器の輪郭を一筆で描いてください。",
  drawTooShort: "線が短すぎます。もう少し長く描いてください",

  selectLook: "見た目から選ぶ",
  appearance: "見た目",
  glazeHeading: "釉薬",
  inspiration: "感覚でつくる",

  color: "色",
  colorWheel: "色相環",
  hslSliders: "HSLスライダー",
  wheelFilters: { all: "すべて", light: "明るめ", medium: "中間", dark: "暗め" },
  hue: "色相",
  saturation: "彩度",
  lightness: "明度",
  surface: "表面",
  transparency: "透明度",
  character: "質感",
  hyomen: {
    HyomenKotaku: "光沢",
    HyomenHanKotaku: "半光沢",
    HyomenTsuyakeshi: "つや消し",
  },
  yuseijoA: {
    YuseijoAMFutoumei: "不透明",
    YuseijoAYusyokuTomei: "有色透明",
    YuseijoAMushokuTomei: "無色透明",
  },
  yuseijoB: {
    YuseijoBKinitsu: "均一",
    YuseijoBFukinnitsu: "不均一",
    YuseijoBKessho: "結晶",
    YuseijoBKannyu: "貫入",
    YuseijoBLuster: "ラスター",
  },
  glazeHint: "薄い項目は今の選択と組み合わせたデータがありません(選ぶことはできます)",
  glazeSelected: "選択中",
  glazeNone: "未選択",
  glazeOpen: "選ぶ",
  glazeChange: "選び直す",
  glazeModalTitle: "釉薬",
  glazeCandidates: "データベースにある組み合わせ",
  glazeCandidatesAll: "左から釉薬を選ぶと絞り込まれます",
  glazeCandidatesNear: "選んだ釉薬をすべて含む組み合わせはありません。近いもの:",
  glazeCandidatesEmpty: "この素地・焼成雰囲気では、選んだ釉薬を含む組み合わせがありません",
  glazeCount: (n: number) => `${n}件`,
  glazeMore: (n: number) => `ほか${n}件。釉薬を追加で選ぶと絞り込めます`,
  glazeConfirm: "決定",
  glazeClose: "閉じる",
  glazeLoading: "データベースを読み込み中...",
  moodPlaceholder: "例：雨上がりの森みたいな、静かで少し湿った感じ…",

  firing: "焼成中...",
  phases: {
    submitting: "焼成ジョブを投入中…",
    queued: "窯の順番待ち… 窯が冷えていると 2〜3 分かかります",
    running: "焼成中… 目安 30 秒前後",
    submitting3d: "焼き上がり。立体にする準備中…",
    queued3d: "立体化の順番待ち… 冷えていると数分かかります",
    running3d: "立体にしています… 目安 30 秒前後",
  },
  stages3d: {
    loading: "モデルを読み込み中…",
    ready: "準備完了",
    cutout: "器を切り抜き",
    coarse_shape: "おおまかな形",
    fine_shape: "細かい形",
    shape_mesh: "表面",
    texture_latent: "質感",
    color_points: "色付け",
  },
  retry3d: "立体化だけやり直す",
  fireFailed: "焼成に失敗しました",
  fireTimeout: "15 分以内に焼き上がりませんでした。もう一度お試しください",
  fireConfig:
    "本番生成 API が未設定のため、選択中の釉薬色を単色で表示しています",
  retry: "もう一度焼成する",

  suggestedRecipe: "推定レシピ",
  disclaimer:
    "生成結果に近い参考レシピです。実際の焼成結果を保証するものではありません。",
  colorFar: "この素地と焼成の組み合わせには近い色の釉薬がありません。いちばん近いものを表示しています",
  rotateLeft: "左に回す",
  rotateRight: "右に回す",

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
