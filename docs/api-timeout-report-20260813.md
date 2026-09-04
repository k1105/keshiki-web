# KESHIKI 生成 API 疎通調査 — executionTimeout で失敗する件

- **日付**: 2026-08-13
- **報告**: 山岸
- **宛先**: 岸さん
- **対象**: RunPod serverless エンドポイント `lo1yxe8s8pojnv`

## 結論

フロントからの生成ジョブが、実行 10 分の上限（`executionTimeout exceeded`）に達して FAILED になります。繋ぎこみガイド（README）記載の**プロンプト直指定サンプルの curl そのままでも再現**するため、リクエスト内容ではなくワーカー側の問題と判断しています。8/2 に 3 件、8/13 の再検証でも 1 件、**3 つの異なるワーカーで計 4 件**再現しました。ワーカーログの確認をお願いしたいです。

なおフロント側の繋ぎこみ実装は完了しており（送信スキーマの修正含む、後述）、サーバーが復旧すればそのまま動く状態です。

## 失敗ジョブ一覧

| 日付 | ジョブ ID | ペイロード | 待ち | 実行 | ワーカー | 結果 |
|---|---|---|---|---|---|---|
| 8/2 | `10e5f08a-eeb6-47f4-a067-756d3ac6c56a-e1` | UI パラメータ経由（本線） | 0.9 s | 603.7 s | `gysb0y7jcefud7` | FAILED |
| 8/2 | `eca89518-b3c2-454f-ac93-66b544cc6447-e1` | 同上リトライ | 14.7 s | 603.6 s | `env18xkgsw9iqz` | FAILED |
| 8/2 | `0bcd6bd3-3b9c-46e4-bb22-5489db9822c0-e1` | README サンプルそのまま | 10.9 s | 603.2 s | `env18xkgsw9iqz` | FAILED |
| 8/13 | `e0617563-82e1-4f99-869b-c119c65310e4-e2` | README サンプルそのまま | 18.2 s | 603.6 s | `iashwmqcxak8m1` | FAILED |

エラーはいずれも `executionTimeout exceeded`。

## 再現手順

ガイドの「1. job 投入」のサンプルそのままです。

```bash
curl -X POST "https://api.runpod.ai/v2/lo1yxe8s8pojnv/run" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $RUNPOD_API_KEY" \
  -d '{"input": {"prompt": "KeshikiCeramic, texture, glossy celadon glaze",
       "gen_params": {"steps": 20, "width": 1024, "height": 1024, "seed": -1}}}'
```

`/status/{id}` をポーリングすると、IN_QUEUE → IN_PROGRESS のまま約 10 分後に FAILED になります。

## 観察したこと・推測

- キュー待ちは 1〜18 秒と短く（warm 相当）、それでも 1024²・20 steps・1 枚の生成が 10 分で終わりません。7/23 実測の「投入から約 16 秒」と大きく乖離しています。生成そのものではなく、**その前段（モデルのロードやダウンロード等）で止まっている**のではと疑っています。
- `/health` はワーカーを ready と報告します（8/13 時点: idle 2 / ready 2 / throttled 1）。
- 一方 8/13 の health カウンタでは `completed: 10 / failed: 9` と成功しているジョブも見えるため、常時ではなく**間欠的（ワーカー個体依存？）**の可能性があります。こちらから投げた分は 4/4 失敗です。

## 別件: README と実装の食い違い 2 点

**① `seger_values` のキー形式。** README の例は酸化物名キーですが、実ワーカーはキーを `int()` するため、酸化物名を送ると即 FAILED になります（実測エラー: `invalid literal for int() with base 10: 'Al2O3'`）。数値インデックス（1〜11）が正のようです。

| README の例（FAILED になる） | 実際に通る形式 |
|---|---|
| `{"KNaO": 0.3, "CaO": 0.7}` | `{"1": 0.3, "4": 0.7}` |

**② 失敗時のエラー文言の場所。** README には「FAILED 時は `output.message`」とありますが、タイムアウト時は `output` が無く、ステータスレスポンスのトップレベル `error` フィールドに入っていました。

どちらもフロント側は実挙動に合わせて対応済みです。README の追記、または handler 側での吸収をお願いできればと思います。

## お願いしたいこと

1. 上記 4 ジョブ（特にワーカー `gysb0y7jcefud7` / `env18xkgsw9iqz` / `iashwmqcxak8m1`）の**ワーカーログの確認**
2. `seger_values` の正式仕様の確定（数値キーで確定なら README 修正、酸化物名にするなら handler 修正）
3. 可能であれば `maintable_choices.json` の共有。現状 `selections` はガイドに例示のある「焼成: 酸化／還元」「素地: 磁器土」だけを送り、残り（透明感・光沢・表情など）は `comment_ja` に畳み込んでいます。選択肢一覧があれば正式に `selections` へ移せます。

---

*KESHIKI web フロント（Next.js）繋ぎこみ作業の一環として調査。フロント側の実装: `POST /api/generate` proxy・2 秒ポーリング・キャンセル・base64 data URL 表示まで実装済み、`next build` 通過確認済み。*
