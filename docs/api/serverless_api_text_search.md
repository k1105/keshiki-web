<!-- 取得元: https://github.com/obake2ai/keshiki-glaze-ai/blob/v5-depth-spec/docs/serverless_api_text_search.md (2026-10-15 取得) -->
# KESHIKI Serverless API 自由探索 (自由文 → 近い実在テストピース)

> 前半 (1〜4) は山岸さん向けの仕様 (案)、後半 (5〜6) は本番に反映するときの手順 (岸・Claude 向け)。
> **ステータス: 試作 (2026-10-12)**。v5 endpoint に足す形で作り、**一時 endpoint で動作を確認した。本番にはまだ入っていない**。
> 宮下さんの UI 案の「ステップ 2-C 感覚で作る」(自由文から近い釉を選ぶ) に当たる。10/8 定例の岸タスク。
> 評価と経緯 = [worklog_2026-10-12_text_search.md](./worklog_2026-10-12_text_search.md)。

## 1. 何をするか

利用者が書いた文 (比喩・情景・色名・英語でもよい) に近い**実在のテストピース**を返す。返った `recipe_id` を
そのまま v5 の生成 (`glaze.recipe_id`) に渡せば、そのテストピースの釉で器が焼ける (DB に無い組み合わせは作らない、10/8 定例の方針)。

中で行っていること:

1. 小型の言語モデルが、文を DB の外観記述の書き方 (色・明るさ・艶・質感・模様) に言い換え、代表色を 1 つ推測する
   (例: 「雨上がりの空のような淡い青」→「光沢のある淡い青色の釉」・`#a0d8f0`)
2. 元の文と言い換え文を、テストピースの記述 (外観 + 釉名称 + 分類) と意味の近さで比べる
3. 代表色とテストピースの平均色が離れているほど順位を下げる。天目・青磁・織部などの様式名が書かれていれば、その釉名称のテストピースに絞る

精度 (上位 5 件のうち、期待した色・分類に合った割合): 言い換えなし 0.46 → 言い換えあり 0.67〜0.77 (評価用 22 本・検証用 14 本)。

## 2. 入力

v5 endpoint (`6s52ljv9lrzrz2`) に、今の key のまま `op: "text_search"` を送る。

```json
{"input": {"op": "text_search", "text": "雨上がりの空のような淡い青", "top_k": 5,
           "filters": {"soji": "SojiToki", "shosei": "ShouseiKangen"}, "rewrite": true}}
```

| キー | 既定 | 説明 |
|---|---|---|
| `op` | (必須) | `"text_search"` |
| `text` | (必須) | 1〜200 文字 |
| `top_k` | 5 | 返す件数 (1〜20) |
| `filters` | なし | UI のステップ 1 で選んだ分類で絞る。キーは `soji` `shosei` `hyomen` `yuseijo_a` `yuseijo_b`、値は生成の `glaze` と同じ (例 `SojiToki`)。絞った結果が 0 件なら絞らずに返し、`relaxed` に外したキーを書く |
| `rewrite` | `true` | `false` で言い換えをしない (速いが比喩に弱い。様式名の絞り込みは効く) |

知らないキー・許可外の値・範囲外はエラー (`ValueError`、理由を日本語で返す。生成の API と同じ方針)。

## 3. 出力 (COMPLETED)

```json
{"text": "雨上がりの空のような淡い青",
 "rewrite": {"description": "光沢のある淡い青色の釉", "color": "#a0d8f0"},
 "style_filter": [],
 "relaxed": [],
 "results": [
   {"recipe_id": "<テストピースの ID>", "score": 0.8812,
    "appearance_ja": "<DB の外観記述 (日本語)>", "appearance_en": "<同 (英語)>",
    "soji": "SojiJiki", "shosei": "ShouseiKangen", "temp": 1280, "hyomen": "HyomenKotaku",
    "yuseijo_a": "YuseijoAYusyokuTomei", "yuseijo_b": "YuseijoBKinitsu",
    "glaze_types": [{"code": "...", "ja": "<釉名称>", "en": "..."}],
    "color": "#a0d8f1"},
   "... top_k 件"],
 "sec": {"rewrite": 0.6, "search": 0.01},
 "meta": {"load_sec": 23.0, "load_stages": {"...": "..."}, "image_tag": "..."}}
```

- `results` は近い順。`color` はテストピースの平均色 (`#rrggbb`)。候補の色見本や、選択肢の表示に使える
- `rewrite` は言い換えの結果 (`rewrite: false` のときは `null`)。画面に「こう読み取りました」と出すこともできる
- `style_filter` は文から見つけた様式名 (例 `["天目"]`)
- `appearance_ja` などテストピースの記述は産総研 DB 由来 (推定レシピと同じ扱い、一般公開しない前提)

## 4. つなぎ方と待ち時間

### UI の流れ (例)

1. ステップ 1 で形・素地・焼成雰囲気を選ぶ → `filters` に `soji` と `shosei` を入れる
2. 自由文を入れたら `op: text_search` を投げる (1〜2 秒で返る)
3. 1 件目を使う、または上位数件を色見本で見せて選ばせる
4. 選んだ `recipe_id` を生成に渡す:
   `{"input": {"depth_png": "...", "glaze": {"recipe_id": "<選んだ recipe_id>"}, "gen_params": {"seed": 42}}}`
   (このとき焼成温度・推定レシピは、選んだテストピースのものが返る)

### 待ち時間 (2026-10-12、一時 endpoint・H100)

| 状態 | 投入から返るまで | 内訳 |
|---|---|---|
| 温まっている | **1.3〜1.5 秒** | 言い換え 0.6 秒 + 検索 0.01 秒 + API の往復 |
| 温まっている・`rewrite: false` | 1.3 秒 | 処理 0.2 秒 (待ちのほとんどは API の往復) |
| 自由探索を初めて使う worker | 処理 約 9〜25 秒 + worker の確保 | モデル読み込み 8〜23 秒 (言い換え 2〜17 秒 + 埋め込み 2〜3 秒 + テストピース 14,365 件の埋め込み 3.5 秒。2 回測って幅がある) |

- 生成と同じ worker で動く。生成用の FLUX と自由探索のモデルは同時に載る (GPU 80GB に収まる)。
  「自由探索 → 生成 → 自由探索」を同じ worker で続けて流し、36 本すべて返ることを確認した (下の 6 の修正の後)
- 同じ文でも、GPU と手元で言い換えの文がわずかに変わることがある (手元の評価と上位 5 件の並びが一致したのは 36 本中 31 本)

## 5. 本番に反映する手順 (岸・Claude)

途中経過 API ([serverless_api_progress.md](./serverless_api_progress.md) の 5) と同じ流れ。**両方まとめて 1 回で入れ替える**のがよい
(試作イメージ `ghcr.io/obake2ai/keshiki-worker:20261012ts2` は v5 の `preview` と自由探索の両方を含む)。

### 5-1. 済んでいること (2026-10-12)

- [x] Volume を 140 → 160GB に拡張 (`8rbbh8fclo`)
- [x] モデルを Volume に配置: `/runpod-volume/models/multilingual-e5-small` (492MB、MIT) / `/runpod-volume/models/Qwen3-4B-Instruct-2507` (7.6GB、Apache-2.0)。
      worker (非 root) が読めるよう `o+rX`。パスは環境変数 `KESHIKI_TS_EMBED` / `KESHIKI_TS_LLM` で変えられる
- [x] テストピースの記述は Volume の索引 (`/runpod-volume/keshiki/recipes_v5.jsonl`、14,365 件・釉名称つき) から worker が作る。手元の埋め込みは置かない
- [x] 一時 endpoint で通し試験 (`scripts/e2e_text_search.py`、イメージ `20261012ts2`): 正常 4・異常 4・「返った recipe_id で生成」の 9/9 合格。
      生成の直後の同じ worker に 36 本流して全部返った。手元の評価との一致 36 本中 31 本
- [x] GPU の空き容量の判定を直した (下の 6 の 2 つ目。直す前のイメージ `20261012ts` では、生成の直後の自由探索で worker が退場した)

### 5-2. 入れる前にすること

- [ ] 6 の 1 つ目 (社内の確認の要否) を決める
- [ ] この文書の 1〜4 を山岸さんに共有する (今の key のまま使える。3D と違って key の権限追加は要らない)

### 5-3. 一時 endpoint で試す・本番を入れ替える・確かめる・戻す

```bash
python3 scripts/make_temp_endpoint.py create --template 50pxjf7a0l --endpoint 6s52ljv9lrzrz2 \
    --image ghcr.io/obake2ai/keshiki-worker:<tag> --name keshiki-v5-tmp
~/.venvs/keshiki-textsearch/bin/python scripts/e2e_text_search.py --eid <一時 v5> --consistency
python3 scripts/make_temp_endpoint.py delete --endpoint <一時 v5> --template <一時 template>
```

本番の入れ替え・確認・戻し方は [serverless_api_progress.md](./serverless_api_progress.md) の 5-4〜5-6 と同じ
(template のイメージを PATCH → endpoint を PATCH して worker を入れ替える → 契約試験と `e2e_text_search.py --eid 6s52ljv9lrzrz2` → 戻すときは前のタグ)。
自由探索の入力を送らなければ、新しいイメージでも生成の挙動は従来どおり。

## 6. 未決・注意

- **社内の確認**: 言い換え (Qwen3-4B、Alibaba) と埋め込み (multilingual-e5-small、Microsoft の研究者が公開) は、
  FLUX.2 [dev] の承認・Runpod の特殊 IT 承認 (IS2607096) で申告した AI サービスの外。本番に入れる前に、確認が要るかを岸が判断する
- **GPU の空き容量の判定 (直した)**: 以前は v5 の worker が読み込み済みかを FLUX.1 用の変数で見ていて、常に 40GB の空きを要求していた。
  生成と自由探索を同じ worker に載せると空きが 37GB になり、自分の使用分を他プロセスの占有と取り違えて worker が退場していた (10/12 に再現)。
  今は「この job でまだ読み込んでいないモデルの分」だけ空きを求め、エラー表示にも自分の使用分 (`own_reserved_gb`) を分けて出す
- Volume: API 上は 160GB に拡張済みだが、配置時に Pod から見た `df` は「全体 150GB・使用 128GB・空き 22GB」で、拡張がそこに反映されていたかは未確認。
  そこへ 8.1GB を置いた。次に大きなものを置く前に、Pod から空きを確かめる
