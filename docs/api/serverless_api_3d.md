<!-- 取得元: https://github.com/obake2ai/keshiki-glaze-ai/blob/v5-depth-spec/docs/serverless_api_3d.md (2026-10-15 取得) -->
# KESHIKI Serverless API 3D — 器の画像から 3D (GLB) を作る (山岸さん向け・案)

> v5 の画像生成 API ([serverless_api_v5.md](./serverless_api_v5.md)) が返した器の画像を 3D モデルにする API。
> 中身は Microsoft TRELLIS.2 (MIT)。v5 とは別の endpoint・別の key 権限。
> **ステータス: 試験稼働 (2026-10-06)**。endpoint を立ち上げ、通しの試験 (成功 2 件・エラー 3 件) まで確認した。
> 検証の記録 = チーム共有ビューアの `/report/3d`、[2d3d_candidates.md](./2d3d_candidates.md)。

## 接続情報

| 項目 | 値 |
|---|---|
| Endpoint ID | `jugnpsimwaub16` (keshiki-3d-fr) |
| Base URL | `https://api.runpod.ai/v2/jugnpsimwaub16` |
| 叩き方 | v5 と同じ (`/run` → `/status/{id}` をポーリング) |
| API key | v5 と同じ key を使う (この endpoint の権限を key に追加する。岸が設定・確認後に連絡) |

## 流れ

```
v5 API (/run) → 器の画像 (data URL) ─┐
                                    └→ 3D API (/run) → GLB (data URL) → <model-viewer> / three.js で表示
```

v5 の出力画像を**そのまま (背景つきで)** 渡す。背景は 3D 側で自動で切り抜く。
深度で切り抜いた透過画像は渡さない (表面が格子状に崩れる。10/6 実測)。

## 入力 (`input`)

```json
{
  "input": {
    "image": "data:image/png;base64,....",
    "quality": "standard",
    "seed": 42
  }
}
```

| キー | 既定 | 説明 |
|---|---|---|
| `image` | (必須) | 器の画像。data URL か base64 の PNG / JPEG。v5 の `images[].url` をそのまま入れてよい |
| `quality` | `standard` | `standard` = 1024 (1〜2 分、推奨) / `high` = 1536 (2〜4 分。細部が増えるが入力に無い縦の筋が乗る) |
| `seed` | 42 | 0 以上の整数。同じ画像・同じ seed なら同じ 3D |

知らないキー・値はエラーにする (v5 と同じ方針)。

## 出力 (`output`、COMPLETED 時)

v5 の八角の瓶の画像を送った実際の応答 (2026-10-06、`glb` の中身と `meta` の一部は省略):

```json
{
  "glb": "data:model/gltf-binary;base64,....",
  "meta": {
    "quality": "standard", "pipeline_type": "1024_cascade", "resolution": 1024, "seed": 42,
    "glb_bytes": 4999604, "max_faces": 150000, "texture_size": 2048,
    "gen_sec": 171.8, "glb_sec": 12.5, "load_sec": 102.4, "rembg": "ZhengPeng7/BiRefNet"
  }
}
```

この `gen_sec` は worker の初回 (コンパイル込み) の値。2 回目以降は 70 秒前後 (下の待ち時間を参照)。

- `glb` は glTF バイナリ (テクスチャは WebP = `EXT_texture_webp`)。`<model-viewer>` や three.js の `GLTFLoader` でそのまま読める
- **RunPod は 10MB を超える応答を返せない**ので、GLB は 6.5MB 以下に収まるまで面数とテクスチャを段階的に下げて返す
  (面数 15 万・テクスチャ 2048 から順に、最小で 3 万・512)。下げた結果は `meta.max_faces` / `meta.texture_size` に入る
- 器は滑らかなので、面数を下げても見た目の劣化は小さい見込み (試験で確認する)

## エラー

受け取り方は v5 と同じ (`status` = `FAILED`、トップレベルの `error` に例外名、`output.message` に詳細)。

| 送ったもの | `error` |
|---|---|
| `image` が無い・画像として読めない | `ValueError` |
| 知らないキー (例: `Quality`) | `ValueError` |
| `quality` の値違い (例: `ultra`) | `ValueError` |
| GPU のメモリ不足 | `OutOfMemoryError` (投げ直せば別の worker に載る) |

## 待ち時間 (2026-10-06 実測、`standard`)

| 状態 | 投入から完了まで | 内訳 |
|---|---|---|
| 待機中の worker あり | **93 秒** | 生成 73 秒 + GLB 書き出し 16 秒 |
| 待機中の worker なし (cold) | **615 秒** | worker の確保とイメージの取得 324 秒 + モデルの読み込み 102 秒 + 初回の生成 172 秒 (コンパイル込み) |

- GLB は 5.0MB (base64 で 6.6MB)。面数 15 万・テクスチャ 2048 のまま 10MB 未満に収まった
- 3D はたまにしか呼ばない想定なので、keep-warm は置かない。**ポーリングの上限は 15 分**にしておく
  (RunPod の実行上限 10 分は処理の時間だけで、確保待ちは含まない)
- UI では「焼成 (v5 の画像) → 仕上がりを 3D で見る」の 2 段にして、3D の待ち時間を演出で見せる想定

## 権利まわり (社内 R&D・一般公開しない前提)

- TRELLIS.2 本体: MIT / 背景除去 BiRefNet: MIT
- 依存の nvdiffrast は「研究・評価目的のみ」、画像特徴の DINOv3 は Meta の独自ライセンス (利用同意済み)
  → 今の社内 R&D の範囲では問題ないが、本番化・一般公開するときは条件を改めて確認する
