<!-- 取得元: https://github.com/obake2ai/keshiki-glaze-ai/blob/v5-depth-spec/docs/serverless_api_progress.md (2026-10-15 取得) -->
# KESHIKI Serverless API 途中経過 (生成途中の絵・3D の途中の形) を受け取る

> 前半 (1〜4) は山岸さん向けの仕様 (案)、後半 (5〜6) は本番に反映するときの手順 (岸・Claude 向け)。
> **ステータス: 試作 (2026-10-12)**。本番 endpoint には**まだ入っていない**。試作イメージを一時 endpoint で動かして、
> 下の時刻と形を実測した。記録と一覧ページ = [worklog_2026-10-12_progress_capture.md](./worklog_2026-10-12_progress_capture.md)。
> 既存の仕様 ([serverless_api_v5.md](./serverless_api_v5.md) / [serverless_api_3d.md](./serverless_api_3d.md)) はそのまま有効。
> 今回のものは**入力に足したときだけ**動く追加で、足さなければ今の挙動と同じ。

## 1. 何が届くか (焼成ボタンから何秒後か)

焼成ボタン = v5 の `/run` を投げた時点からの秒。2026-10-12 実測 (EU-FR-1・H100、`/status` を 0.4 秒間隔でポーリング)。

| 届くもの | API | 届く場所 | 両方温まっている | 3D が冷えている | 形 | 状態 |
|---|---|---|---|---|---|---|
| 焼成温度・推定レシピ | v5 | IN_PROGRESS の `output.recipe` | 0.9 秒 | 1.0 | JSON (約 1 KB) | 今ある |
| 生成途中の絵 (10 枚) | v5 | IN_PROGRESS の `output.preview` | 4.6〜34.0 | 4.2〜34.3 | JPEG の data URL (1 枚 約 12 KB) | **追加** |
| v5 の完成画像 | v5 | COMPLETED の `output.images` | 37.3 | 37.6 | PNG の data URL (約 1.3 MB) | 今ある |
| 背景の切り抜き | 3D | IN_PROGRESS の `output.image` | 39.7 | 216.5 | JPEG の data URL (約 10 KB) | **追加** |
| 粗い形の粒 | 3D | IN_PROGRESS の `output.points` | 43.4 | 221.2 | 32³ の格子の点 (約 23 KB) | **追加** |
| 細かい形の粒 | 3D | IN_PROGRESS の `output.points` | 50.8 | 360.2 | 64³ の格子の点 (約 81 KB) | **追加** |
| 色のない形状 | 3D | 途中経過は面数だけ。GLB は COMPLETED の `output.detail` | 51.9 | 392.7 | GLB の data URL (約 470 KB) | **追加** |
| 色付きの粒 | 3D | IN_PROGRESS の `output.points` (`rgb` つき) | 56.1 | 397.2 | 点 + 色 (約 240 KB) | **追加** |
| 完成 GLB | 3D | COMPLETED の `output.glb` | **73.3** | 414.6 | GLB の data URL (約 7 MB) | 今ある |

- v5 が冷えているとき (worker の確保待ち 79 秒) は、全体がそのぶん後ろにずれる (GLB 182.5 秒)
- 3D が冷えているときの待ちは「粗い形 → 細かい形」の間 (初回のコンパイル、約 140 秒) に集中する。粗い形の粒はその前に届くので、待ちの間も見せられる
- 3D は keep-warm (15 分ごと) で温めている。ただし EU-FR-1 の GPU の在庫が切れていると、3D の確保待ちが数分〜十数分になることがある (10/12 に 13 分を記録)

## 2. v5: 生成途中の絵 (`preview`)

### 入力

既存の入力に `preview` を足す。

```json
{"input": {"depth_png": "...", "glaze": {"...": "..."}, "gen_params": {"seed": 42},
           "preview": {"every": 3, "size": 384}}}
```

| キー | 範囲 | 説明 |
|---|---|---|
| `every` | 1〜50 | 何ステップごとに途中の絵を送るか。生成は 30 ステップなので 3 なら 10 枚 |
| `size` | 64〜1024 | 途中の絵の一辺 (px)。384 で 1 枚 約 12 KB |

`preview` を入れなければ従来どおり (途中の絵は作らない)。知らないキー・範囲外はエラー (`ValueError`)。

### 途中経過 (IN_PROGRESS)

```json
{"status": "IN_PROGRESS",
 "output": {"stage": "generating", "t": 3.57, "recipe": {"...": "従来と同じ"},
            "preview": {"step": 3, "steps": 30, "image": "data:image/jpeg;base64,/9j/4AAQ..."}}}
```

- `t` = worker が job を受け取ってからの秒 (全部の途中経過に入る。従来の途中経過にも足した)
- 途中の絵は「その時点の完成予想」。3 ステップ目 (生成開始から約 4 秒) で器の形・構図、6 ステップで釉の色が出て、12〜15 ステップでほぼ完成と見分けがつかない
- ⚠️ **`/status` の途中経過は上書き**で、最後の 1 件しか見えない。途中の絵は約 3.3 秒ごとに来るので、ポーリングは 1 秒間隔くらいにする。取りこぼしても、完了時の `previews` に全部入っている

### 完了時 (COMPLETED)

従来の `images` / `recipe` / `meta` に加えて、`preview` を入れたときだけ次が入る。

```json
{"previews": [{"step": 3, "t": 3.57, "image": "data:image/jpeg;base64,..."}, "... 10 枚"],
 "timeline": [{"stage": "recipe_selected", "t": 0.11}, {"stage": "generating", "t": 0.11}, "...",
              {"stage": "image_done", "t": 36.4, "index": 0}]}
```

途中の絵を作る追加の時間は、測れる差がなかった (同じ日・同じ入力で、焼成ボタンから完成画像まで preview なし 38.3 秒 / あり 37.3 秒。worker ごとのぶれのほうが大きい)。

## 3. 3D: 途中の形 (`detail`)

### 入力

```json
{"input": {"image": "<v5 の images[0].url>", "quality": "standard", "seed": 42, "detail": true}}
```

`detail` を入れなければ従来どおり。`true` / `false` 以外はエラー。

### 途中経過 (IN_PROGRESS) の段階

届く順。`t` = 3D の worker が job を受け取ってからの秒 (両方温まっているときの実測)。

| `stage` | `t` | 中身 |
|---|---|---|
| `ready` | 0.1 | モデル読み込み済み (cold のときは `load_sec` に読み込み秒) |
| `cutout` | 1.2 | `image`: 背景を除いた器の JPEG (384px) |
| `coarse_shape` | 4.8 | `res`: 32、`points`: 大まかな形の点 |
| `fine_shape` | 12.3 | `res`: 64、`points`: 細かい形の点 (最大 6,000 点に間引き) |
| `shape_mesh` | 13.2 | `faces`: 色のない形状の面数 (GLB 本体は完了時の `detail.shape_mesh.glb`) |
| `texture_latent` | 16.0 | 中身なし (質感の計算が終わった合図) |
| `color_points` | 17.3 | `points`: 色付きの点 (最大 8,000 点に間引き、`rgb` つき) |

`points` の形:

```json
{"stage": "color_points", "t": 17.27,
 "points": {"n_total": 1822595,
            "xyz": [[254, 463, 163], [255, 462, 359], "..."],
            "rgb": [[15, 15, 15], [7, 7, 7], "..."]}}
```

- `xyz` は格子の整数座標。粗い形は 0〜31、細かい形は 0〜63、色付きの点は 0〜1023。**z が上** (TRELLIS の座標)
- three.js など y が上の表示では `(x, y, z) → (x, z, -y)` と入れ替える。完成 GLB は最初から y が上なので、入れ替え後の向きが GLB と一致する
- `n_total` は間引く前の数、`xyz` は間引いた後の点 (粗い形は 1,760 点で間引きなし)
- `rgb` は 0〜255 の基本色 (質感のボクセルの色そのもの)

### 完了時 (COMPLETED)

従来の `glb` / `meta` に加えて、`detail` を入れたときだけ次が入る。

```json
{"detail": {"cutout": {"t": 1.2, "image": "..."}, "coarse_shape": {"t": 4.79, "res": 32, "points": {"...": "..."}},
            "shape_mesh": {"t": 13.23, "faces": 19907, "glb": "data:model/gltf-binary;base64,..."}, "...": "..."},
 "timeline": [{"stage": "ready", "t": 0.1}, "...", {"stage": "glb", "t": 33.63}]}
```

- RunPod の応答は 10MB が上限なので、`detail` を入れたときは完成 GLB の上限を 5.5MB に下げる (面数・テクスチャを段階的に下げる仕組みは従来どおり)
- **`detail` を入れると 3D 全体が約 10 秒延びる** (同じ v5 画像・温まっている worker で、なし 23 秒 = 生成 13.3 + GLB 9.7 / あり 33.5 秒 = 生成 17.2 + GLB 16.3、10/12 実測)。
  色のない形状を 1 回多く復号するぶんと、途中経過の送信 (大きいもので 240 KB) が効いているとみられる。冷えているときの差は測っていない。
  本番で GLB までの時間を優先したい場合は、`color_points` や `shape_mesh` を外す選択肢もある

## 4. フロントでの受け取り方 (例)

1. v5 の `/run` を投げ、`/status` を 1 秒ごとに見る
2. 最初の途中経過の `recipe.temp` で温度カウンターの目標を決める (0.9 秒前後)
3. `preview` が来るたびに絵を差し替える (同じ `step` は 1 回だけ扱う)
4. COMPLETED の `images[0].url` を、そのまま 3D の `/run` に `detail: true` つきで渡す
5. 3D の `/status` を 1 秒ごとに見て、`stage` が変わるたびに見せ方を切り替える
   - `cutout`: 切り抜いた器を表示
   - `coarse_shape` → `fine_shape`: 粒を出す → 細かい粒に置き換える (粒が集まって器になる演出)
   - `color_points`: 粒に色を付ける
   - COMPLETED: `glb` を `<model-viewer>` / three.js の `GLTFLoader` で表示
6. 色のない形状を見せたい場合は、完了時の `detail.shape_mesh.glb` を使う (途中経過には GLB 本体は載らない)

粒の描画の最小例 (three.js):

```js
const {n_total, xyz, rgb} = output.points;
const pos = new Float32Array(xyz.length * 3), col = new Float32Array(xyz.length * 3);
const lo = [0, 1, 2].map((k) => Math.min(...xyz.map((p) => p[k])));
const hi = [0, 1, 2].map((k) => Math.max(...xyz.map((p) => p[k])));
const c = lo.map((v, k) => (v + hi[k]) / 2), s = 1.6 / Math.max(...hi.map((v, k) => v - lo[k]));
xyz.forEach((p, i) => {
  pos.set([(p[0] - c[0]) * s, (p[2] - c[2]) * s, -(p[1] - c[1]) * s], i * 3);  // z が上 → y が上
  const [r, g, b] = rgb ? rgb[i].map((v) => v / 255) : [0.9, 0.55, 0.35];
  col.set([r, g, b], i * 3);
});
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
scene.add(new THREE.Points(geo, new THREE.PointsMaterial({size: 0.03, vertexColors: true})));
```

岸の手元に、実物と時刻を並べた一覧ページがある (`scripts/build_progress_catalog.py`、127.0.0.1 でだけ開く)。
画像・形は産総研 DB で学習した LoRA の生成物なので、共有はパスワード付きのチーム用ページで行う。

## 5. 本番に反映する手順 (岸・Claude)

試作のコード: `docker/worker/handler.py` / `pipeline_v5.py` (v5 の `preview`)、`docker/worker3d/handler3d.py` (3D の `detail`)。
試作イメージ: `ghcr.io/obake2ai/keshiki-worker:20261012cap` / `ghcr.io/obake2ai/keshiki-worker3d:20261012cap`。
v5 は、自由探索 ([serverless_api_text_search.md](./serverless_api_text_search.md)) と GPU の空き容量の判定の修正も入った
`ghcr.io/obake2ai/keshiki-worker:20261012ts2` を使う (v5 の入れ替えはこれ 1 回で両方入る)。

### 5-1. 入れる前に直すこと

- [ ] **色のない形状の GLB の向きと法線**: 今は TRELLIS の座標 (z が上)・法線なしのまま返している。
      `handler3d.py` の `_shape_glb` で `(x, y, z) → (x, z, -y)` に回して法線を付ける (一覧ページでは手元で同じ処理をしている = `build_progress_catalog.py` の `shape_view_glb`)
- [ ] **3D の読み込み中の途中経過を v5 と同じ形に**: 今は `"loading TRELLIS.2"` という文字列。`{"stage": "loading"}` にそろえる
- [ ] 契約試験を足す: `scripts/check_v5_api_contract.py` に `preview` の範囲外・知らないキーのエラーと、途中の絵が届くこと。
      `scripts/e2e_3d_endpoint.py` に `detail` の段階がそろうこと
- [ ] この文書の 1〜4 を [serverless_api_v5.md](./serverless_api_v5.md) / [serverless_api_3d.md](./serverless_api_3d.md) に追記する

### 5-2. イメージを作る

```bash
IMAGE=ghcr.io/obake2ai/keshiki-worker:YYYYMMDDx   bash scripts/build_worker.sh
IMAGE=ghcr.io/obake2ai/keshiki-worker3d:YYYYMMDDx bash scripts/build_worker3d.sh
```

- 3D はビルドのキャッシュが消えていると全部作り直しになる (10/12 は git clone から。push まで 20〜30 分)
- タグは本番と別のものにする (本番の今のタグ: v5 `20261009v5d`、3D `20261006b`。戻すときに使う)

### 5-3. 一時 endpoint で試す (本番は触らない)

```bash
python3 scripts/make_temp_endpoint.py create --template 50pxjf7a0l --endpoint 6s52ljv9lrzrz2 \
    --image ghcr.io/obake2ai/keshiki-worker:YYYYMMDDx --name keshiki-v5-tmp
python3 scripts/make_temp_endpoint.py create --template 8r0s4amxz6 --endpoint jugnpsimwaub16 \
    --image ghcr.io/obake2ai/keshiki-worker3d:YYYYMMDDx --name keshiki-3d-tmp
python3 scripts/capture_progress.py --v5 <一時 v5> --d3 <一時 3D> --name check_YYYYMMDD
python3 scripts/check_v5_api_contract.py --eid <一時 v5>
python3 scripts/make_temp_endpoint.py delete --endpoint <一時 v5> --template <一時 v5 の template>
python3 scripts/make_temp_endpoint.py delete --endpoint <一時 3D> --template <一時 3D の template>
```

- 一時 endpoint は本番と同じ Volume・GPU の種類を使うので、試している間は本番と GPU を取り合う。山岸さんのつなぎ込みが止まっている時間帯に行う
- 終わったら必ず消す (`delete` は GET で 404 になったことまで確かめる)

### 5-4. 本番を入れ替える

1. 山岸さんに入れ替えの時間を事前に連絡する (数分〜数十分、生成できない時間が出る可能性がある)
2. 本番 template のイメージを新しいタグにする (v5 `50pxjf7a0l`、3D `8r0s4amxz6`、REST の PATCH `/templates/{id}`)
3. ⚠️ **template を変えただけでは、動いている worker は古いイメージのまま** (10/9 に確認)。
   endpoint を PATCH (例: `idleTimeout` を 1 秒変えて戻す) すると worker が入れ替わる
4. 入れ替え直後は worker の確保とイメージの取得で数分かかる。EU-FR-1 の在庫が薄いと長引く
   (10/9 は v5 が約 24 分生成できず、10/12 は 3D の確保に 13 分)

### 5-5. 確かめる

- 応答の `meta.image_tag` が新しいタグになっているか
- 山岸さんに渡している key で契約試験: `KESHIKI_RUNPOD_KEY_NAME=keshiki_runpod_scoped_key python3 scripts/check_v5_api_contract.py --eid 6s52ljv9lrzrz2`
- 本番に向けて `scripts/capture_progress.py` を 1 回流し、時刻が 1 の表と同じくらいか
- keep-warm (`com.obake2ai.keshiki-keepwarm-v5` / `-3d`) は `preview` / `detail` を使わないので影響しない。ログ (`/tmp/keshiki_keepwarm_v5.jsonl` / `_3d.jsonl`) が COMPLETED で続いているかだけ見る

### 5-6. 戻し方

本番 template のイメージを前のタグ (v5 `20261009v5d` / 3D `20261006b`) に戻し、5-4 の 3 と同じく endpoint を PATCH して worker を入れ替える。
入力に `preview` / `detail` を足していなければ、新しいイメージでも挙動は従来と同じなので、フロント側の変更は戻さなくてよい。

## 6. 未決・注意

- **山岸さんの key に 3D endpoint (`jugnpsimwaub16`) の権限がまだ無い** (岸が RunPod の Console で追加する)。3D を叩くにはこれが先
- 途中経過に載せられる大きさの上限は確かめていない。今回の最大は色付きの点の約 240 KB で、問題なく届いた
- 社内 R&D・一般公開しない前提 (産総研 DB の契約、FLUX.2 [dev] の承認の範囲)。3D の依存 (nvdiffrast・DINOv3) も研究・評価目的の条件つき ([serverless_api_3d.md](./serverless_api_3d.md) の「権利まわり」)
