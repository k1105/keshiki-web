<!-- 取得元: https://github.com/obake2ai/keshiki-glaze-ai/blob/v5-depth-spec/docs/serverless_api_v5.md (2026-10-15 取得) -->
# KESHIKI Serverless API v5 — 深度画像から器を生成する (山岸さん向け・案)

> 10/1 定例の決定 (v5 本命・深度画像はフロントで作る) に合わせた新しい生成 API。
> 従来の API (`serverless_api.md`、FLUX.1・テストピースの t2i) とは別の endpoint で動かす。
> **ステータス: 試験稼働 (2026-10-05)**。endpoint は立ち上げ済みで、通しの試験 (下記) まで確認した。
> 深度画像の作り方は [depth_input_spec.md](./depth_input_spec.md)。
> **2026-10-09 追加**: 推定レシピの項目 (釉名称・ゼーゲル式・基礎釉と添加物の調合) と、
> 焼成温度を画像より先に受け取る方法 ([途中経過](#途中経過-焼成温度を画像より先に受け取る)) を足した。従来の項目は変えていない。

## 接続情報

| 項目 | 値 |
|---|---|
| Endpoint ID | `6s52ljv9lrzrz2` (keshiki-v5-fr) |
| Base URL | `https://api.runpod.ai/v2/6s52ljv9lrzrz2` |
| 叩き方 | 従来と同じ (`/run` で投入 → `/status/{id}` をポーリング)。`serverless_api.md` を参照 |
| API key | **今お渡ししている key をそのまま使う**。この endpoint の権限を key に追加する (岸が Console で設定、追加後にその key で動作確認してから連絡) |

## 性能 (2026-10-05 実測)

| 状態 | 所要 |
|---|---|
| warm (モデル読み込み済みの worker) | 生成 約 32 秒 / 枚 + 待ち 0.1 秒 |
| worker の読み込み (cold) | 約 26 秒 (Volume からモデル 35GB を先読み 19 秒 + ロード) + worker の確保・イメージ取得 |

- 生成の回帰確認: 9/26 に検証した画像と同じ入力で、**画素単位で完全一致**
- 待機させる worker (keep-warm) は、つなぎ込みの期間だけ動かす予定。止めている間は初回が上の cold の時間ぶん遅れる

## 何が変わるか

| | 従来 (v3) | v5 |
|---|---|---|
| 出力 | テストピース (平らなタイル) の画像 | **空間に置かれた器**の画像 |
| 形の指定 | なし | **深度画像** (プリセット or 一筆書き) |
| 釉薬の指定 | パラメータ → プロンプトを組み立て | パラメータ + 色 → **いちばん近い実在レシピ**を選び、その記述で生成 |
| 生成時間 (warm) | 約 14 秒 | 約 32 秒 (焼成演出の時間で吸収する想定) |

釉薬をパラメータだけから組み立てないのは、v4 / v5 のモデルが色を「外観の記述文」から学んでいて、
パラメータだけでは色が崩れるため (実測)。代わりに DB の実在レシピのうち、選んだ条件と色に
いちばん近いものを使う。そのレシピを応答で返すので、焼成後の「レシピ表示」にそのまま使える。

## 入力 (`input`)

```json
{
  "input": {
    "depth_png": "<base64 PNG 1024x1024 (data URL 可)>",
    "glaze": {
      "soji": "SojiToki",
      "shosei": "ShouseiKangen",
      "hyomen": "HyomenKotaku",
      "yuseijo_a": "YuseijoAMFutoumei",
      "yuseijo_b": "YuseijoBKinitsu",
      "color": "#151318"
    },
    "scene": "window",
    "gen_params": {"seed": -1, "num_images": 1}
  }
}
```

### 形: `depth_png` か `depth_preset` のどちらか

- `depth_png`: フロントで作った深度画像 (仕様は depth_input_spec.md)
- `depth_preset`: サーバー側に置いたプリセット深度の名前 (英数字・`_`・`-`)。本番のプリセットの名前は相談して決める。
  試験用に次の 6 つを置いてある (中身は depth_input_spec.md のサンプルと同じ):
  `sample_tall` (瓶) / `sample_bowl` (鉢) / `sample_hand` (手描き) / `sample_preset` (線画プリセット) /
  `sample_blender` (Blender で焼いた壺) / `sample_floor` (床ありの確定版)
- 物体が写っていない (値 > 0 の画素が 2% 未満) と `ValueError`。器の中の階調が乏しいと `meta.depth.warning` に注意が入る

### 釉薬: `glaze`

**A. 条件と色から選ぶ** (UI の本線)。すべて省略可。値は DB の分類トークン:

| キー | UI | 値 (索引の件数) |
|---|---|---|
| `soji` | 素地 | `SojiToki` 陶器 (12,831) / `SojiJiki` 磁器 (1,353) / `SojiAkatsuchi` 赤土 (**58**) / `SojiOther` その他 (115) |
| `shosei` | 焼成雰囲気 | `ShouseiSanka` 酸化 (7,942) / `ShouseiKangen` 還元 (6,204) |
| `hyomen` | 表情 (艶) | `HyomenKotaku` 光沢 (8,169) / `HyomenHanKotaku` 半光沢 (3,012) / `HyomenTsuyakeshi` つや消し (2,478) |
| `yuseijo_a` | 透明度 | `YuseijoAMFutoumei` 不透明 (11,417) / `YuseijoAYusyokuTomei` 有色透明 (1,996) / `YuseijoAMushokuTomei` 無色透明 (523) |
| `yuseijo_b` | 質感 | `YuseijoBKinitsu` 均一 (8,534) / `YuseijoBFukinnitsu` 不均一 (4,323) / `YuseijoBKessho` 結晶 (1,004) / `YuseijoBKannyu` 貫入 (222) / `YuseijoBLuster` ラスター (21) |
| `color` | 色 | `#rrggbb` |
| `top_k` | (任意) | 近い順の上位 k 件から seed で 1 つ選ぶ。同じ選択でも毎回少し違う釉薬にしたいとき。既定 1 |

選び方: 指定した分類がすべて一致するレシピのうち、平均色が `color` にいちばん近いもの (CIEDE2000)。
- 一致するレシピが無いときは、重要度の低い順 (質感 → 艶 → 透明度) に条件を外す
- 一致はしても色が遠い (ΔE > 12) ときも、**素地と焼成は守ったまま**残りの条件を外して色を優先する
- 外した条件は応答の `recipe.relaxed` に入る

⚠️ 素地・焼成の組み合わせによっては、DB にその色が無い。例: 赤土 × 還元で青を指定 → 最も近くても ΔE 33 の灰緑。
応答の `recipe.delta_e_to_color` が大きい (目安 15 以上) ときは、UI で「この組み合わせに近い色はありません」などと出すとよい。
UI 案の「陶器レッド」を赤土に当てる場合、赤土のレシピは 58 件しかないので選べる色がかなり限られる。

**B. レシピを直接指定** (釉薬スタイルのカタログから選ぶ場合など):

```json
"glaze": {"recipe_id": "00306812"}
```

### 背景: `scene`

| 値 | 見た目 |
|---|---|
| `window` (既定) | 窓辺の斜光、木の卓と壁、落ち影あり。空間の実在感がいちばん出る |
| `studio` | グレーの無地背景の物撮り。色の確認向き。背景の切り抜きもしやすい見込み |

### `gen_params` (すべて省略可)

| キー | 既定 | 説明 |
|---|---|---|
| `seed` | -1 (ランダム) | |
| `num_images` | 1 | 1〜4 |
| `steps` / `guidance` / `refcontrol` / `glaze_scale` | 30 / 4.0 / 1.3 / 1.0 | 検証済みの値。基本は触らない |

## 出力 (`output`、COMPLETED 時)

上の入力例を、深度サンプル `a3_probe_tall.png` で実際に流した結果 (2026-10-05、`url` と `meta` の一部は省略)。
外観の記述と平均色は産総研 DB の中身なので、この文書 (GitHub) には載せず `<…>` で示す:

```json
{
  "prompt_used": "photograph of a glazed ceramic vase lit by a large window from the left, smooth tonal gradient ...",
  "images": [{"url": "data:image/png;base64,...", "seed": 42, "elapsed_sec": 60.8}],
  "recipe": {
    "image_id": "<8 桁の画像 ID>",
    "soji": "SojiToki", "shosei": "ShouseiKangen", "temp": 1280,
    "hyomen": "HyomenKotaku", "yuseijo_a": "YuseijoAMFutoumei", "yuseijo_b": "YuseijoBKinitsu",
    "lab": ["<L*>", "<a*>", "<b*>"],
    "appearance_ja": "<DB の外観記述 (日本語)>",
    "appearance_en": "<その英訳>",
    "glaze_types": [{"code": "<釉名称コード>", "ja": "<釉名称>", "en": "<英訳>"}],
    "seger": {"KNaO": 0.3, "Li2O": 0, "MgO": 0, "CaO": 0.7, "SrO": 0, "BaO": 0, "ZnO": 0, "PbO": 0,
              "Al2O3": 0.4, "SiO2": 3.0, "B2O3": 0},
    "formula": {
      "base": "<基礎釉の調合 (原料と割合)>",
      "additives": "<添加物と添加量>",
      "sections": [{"label": "基礎釉", "text": "<…>"}, {"label": "添加物", "text": "<…>"}],
      "text": "<原料配合割合の原文>"
    },
    "delta_e_to_color": 2.95,
    "relaxed": [],
    "candidates": 3117
  },
  "meta": {"backend": "flux2_v5", "scene": "window", "depth": {"size": [1024, 1024], "object_ratio": 0.208, "object_std": 74.1}, "...": "..."}
}
```

`elapsed_sec` 60.8 は、同じ GPU で別の生成を並行させていた手元試験のときの値。endpoint では 32 秒前後 (上の性能を参照)。

- `recipe` が選ばれた実在レシピ。焼成後のレシピ表示に使える (一般公開しない前提、2026-10-05)
- `url` は従来どおり base64 の data URL (R2 は未設定)
- `seger` の値はこの例のための仮の数字

### 推定レシピの項目 (結果画面用、2026-10-09 追加)

10/8 定例で宮下さんが挙げた項目 (素地・焼成温度・焼成雰囲気・ゼーゲル式・基礎釉と添加物の調合) を、
選ばれた実在レシピから返す。生成に使ったレシピそのものなので、生成条件とずれない。
画面では「推定レシピ」として ※ を付ける (このレシピで焼いても生成画像と同じになるとは限らないため)。

| キー | 中身 | 無いとき |
|---|---|---|
| `soji` / `shosei` / `temp` | 素地 / 焼成雰囲気 / 焼成温度 (℃、整数) | 全件にある |
| `glaze_types` | 釉名称 (DB のコードと日本語名・英訳)。1 件に複数つくことがある | 空の配列 |
| `seger` | ゼーゲル式 (mol)。`KNaO`〜`PbO` の 8 つが融剤で合計 1.0、`Al2O3`・`SiO2`・`B2O3` は別。0 の酸化物も入れているので、表示では 0 を省いてよい | `null` (DB の約 40%) |
| `formula.base` | 基礎釉 (ベースの釉) の原料と割合 | `null` (DB の約 60%。ゼーゲル式で書かれているレシピが多い) |
| `formula.additives` | 添加物と添加量 | `null` (約 20%) |
| `formula.sections` | DB の「原料配合割合」を見出しごとに分けたもの。見出しは `基礎釉` `添加物` `使用粘土` `焼成条件` など | — |
| `formula.text` | 「原料配合割合」の原文 | `formula` 自体が `null` (約 1%) |

DB の「原料配合割合」は自由記述なので、`base` / `additives` は見出し (`基礎釉` / `添加物` など) で区切って取り出したもの。
見出しの無い書き方のレシピでは両方 `null` になり、原文は `text` に残る。「出せる場合は出す」の表示にそのまま使える。

## 途中経過 (焼成温度を画像より先に受け取る)

焼成温度のカウンター演出は画像より先に温度が要るので、worker はレシピを選んだ時点 (モデルの読み込みや生成より前) で
**途中経過として `recipe` を送る**。`/status/{id}` を `IN_PROGRESS` の間にポーリングすると、`output` にこれが入っている:

```json
{"status": "IN_PROGRESS", "output": {"stage": "generating", "recipe": {"temp": 1280, "...": "COMPLETED の recipe と同じ形"}}}
```

- `stage` は `recipe_selected` → (worker が cold なら読み込みの段階名がいくつか) → `generating`。どの段階でも `recipe` は同じものが入っている
- 10/9 の実測 (4 秒ごとのポーリング): cold の worker では開始 21 秒後 (モデル読み込み中) に届き、画像は 171 秒後。
  warm では最初のポーリング (4.6 秒) で届いた。生成時間は 10/5 は 1 枚 32 秒、10/9 は同じ入力で 120 秒 (GPU マシンの差とみて様子見中)
- `IN_QUEUE` (worker の確保待ち) の間はまだ届かない。その間はカウンターを汎用の動きで回し、`recipe.temp` が来た時点で目標温度に向かわせる形を想定
- 以前の途中経過は文字列 (cold の読み込み中だけ) だったが、今はオブジェクト。`output` を文字列として表示していた場合は直す

## エラー

受け取り方は従来と同じ。job の `status` が `FAILED` になり、トップレベルの `error` に例外名、`output.message` に詳細 (日本語) が入る。

**知らないキーや値は黙って無視せず、エラーにする** (旧 API で「綴り違いのキーが黙って捨てられ、指定が効かない絵が出る」不具合があったため)。
入力の検査はモデルの読み込みより前に行うので、cold な worker でも数秒で返る。

| 送ったもの | `error` | `output.message` の例 |
|---|---|---|
| 深度なし | `ValueError` | depth_png (base64 PNG) か depth_preset が要る |
| 無いプリセット名 | `ValueError` | depth_preset が無い: nope |
| 物体が写っていない深度 | `ValueError` | 深度画像に物体が写っていない (値 > 0 の画素が 2% 未満) |
| `input` / `glaze` / `gen_params` に知らないキー (例: `Soji`、旧 API の `selections`) | `ValueError` | glaze に知らないキー ['Soji']。使えるキー = [...] |
| 分類に知らない値 (例: `"soji": "陶器"`) | `ValueError` | glaze.soji の値 '陶器' は使えない。使える値 = [...] |
| 色の書式違い | `ValueError` | glaze.color は #rrggbb で渡す: '#12345' |
| `scene` の値違い | `ValueError` | scene の値 'garden' は使えない。使える値 = ['studio', 'window'] |
| 無い `recipe_id` | `ValueError` | recipe_id が索引に無い: ... |

worker 個体の不良 (`GpuMemoryUnavailable` / `CudaUnavailable` / `OutOfMemoryError`) は従来と同じく、投げ直せば別の個体に載る。

## 待ち時間について (2026-10-05 実測)

EU-FR-1 の GPU の在庫が薄いとき、worker の確保に時間がかかる (`/health` の `workers.throttled` が在庫待ち)。
待機中の worker が無い状態からの初回の実測:

| 時刻 (UTC) | 確保待ち | 処理 (読み込み + 生成) | 合計 |
|---|---|---|---|
| 10/5 15:0x | 98 秒 | 61 秒 | 160 秒 |
| 10/5 15:1x | 54 秒 | 64 秒 | 120 秒 |
| 10/5 15:2x | **663 秒** | 135 秒 | **800 秒** |

3 回目は、同じ DC の H100 / H200 を岸側の別の計算 (全数評価、10/6 未明まで) が占有していた時間帯で、
worker の確保が長引いたうえ、生成も 1 枚 90〜110 秒と遅かった (A100 に割り当てられたとみられる)。
- **つなぎ込みは、この計算が終わる 10/6 以降、keep-warm で worker を待機させた状態で始める** (その状態なら 32 秒前後)
- クライアントのポーリングは **15 分を上限**にしておくと、在庫が薄い時間帯でも取りこぼさない
  (RunPod の実行上限 10 分は「処理」の時間だけで、確保待ちは含まない)

## 未定のこと

- 今の API key へのこの endpoint の権限の追加 (岸が設定・確認後に連絡)
- 本番の `depth_preset` の名前の付け方 (今は試験用の `sample_*` のみ)
- 背景の切り抜き (depth_input_spec.md の 5)
