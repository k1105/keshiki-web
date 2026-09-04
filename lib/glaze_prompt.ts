// KESHIKI 本番システムとの I/O 契約の TS 型定義。
// 正本: docker/worker/handler.py (本番リポジトリ) / serverless API 繋ぎこみガイド (2026-07-23 疎通確認版)

/**
 * 離散カテゴリの選択結果。key はカテゴリ名、値は選択肢の配列で、いずれも日本語。
 * 正本は web/public/data/maintable_choices.json (本番リポジトリ)。
 * ガイドでの例示: {"焼成": ["酸化"], "素地": ["磁器土"]}
 */
export type Selections = Record<string, string[]>;

/**
 * Seger (ゼーゲル式 UMF) スライダー値。key は数値インデックス 1..11:
 * 1 KNaO / 2 Li2O / 3 MgO / 4 CaO / 5 SrO / 6 BaO / 7 ZnO / 8 PbO /
 * 9 Al2O3 / 10 SiO2 / 11 B2O3。
 * ⚠ ガイドの例示は酸化物名キー ({"KNaO": 0.3}) だが、実ワーカーは
 * int(key) するため酸化物名を送ると FAILED になる (2026-08-02 実測)。
 */
export type SegerValues = Record<number, number>;

export type GenParams = {
  steps?: number; // 既定 20
  guidance?: number; // 既定 15
  width?: number; // 既定 1024
  height?: number; // 既定 1024
  seed?: number; // 既定 -1 (= ランダム)
  num_images?: number; // 1〜4
  /** 🆕 i2i 予定仕様: 元画像の保持度 0〜1 (低い = 元画像寄り) */
  strength?: number;
};

/** POST /api/generate の JSON ボディ。API → RunPod ワーカーへほぼそのまま透過する */
export type GenerateInput = {
  /** 🆕 i2i 予定仕様: 壺の輪郭プリセット */
  base_image?: { preset_id: string; url?: string };
  selections?: Selections;
  seger_values?: SegerValues;
  anchor?: string; // 既定 "KeshikiCeramic, texture"
  comment_ja?: string; // 手入力コメント (任意)
  auto_comment?: boolean; // 既定 true = Excel 行から自動
  gen_params?: GenParams;
  /** 指定時はプロンプト組み立てを skip して直投入 */
  prompt?: string;
};

export type GeneratedImage = {
  /**
   * 現状は base64 data URL (R2 未設定の fallback、1024² で約 2MB)。
   * R2 導入後は https URL に変わる予定。フロントはどちらでも表示できること。
   */
  url: string;
  seed: number; // その画像の確定 seed
  elapsed_sec: number; // 生成所要秒
};

/** ワーカー (handler.py) が返す JSON。API はそのまま中継する */
export type GenerateOutput = {
  prompt_used: string;
  images: GeneratedImage[];
  meta?: {
    steps?: number;
    guidance?: number;
    width?: number;
    height?: number;
    model?: string;
    lora?: string;
    lora_scale?: number;
    base_image?: string; // 🆕 i2i 条件
    strength?: number; // 🆕 i2i 条件
    [key: string]: unknown;
  };
};

export type GenerateError = {
  error: string; // 例 "pod_api_unreachable"
  message?: string;
};

export function isGenerateError(o: unknown): o is GenerateError {
  return (
    typeof o === "object" &&
    o !== null &&
    typeof (o as GenerateError).error === "string"
  );
}

/** RunPod serverless のジョブ状態 (RUNNING は IN_PROGRESS と同義で扱う) */
export type JobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

/** POST /api/generate (proxy) のレスポンス */
export type JobSubmitResponse = { id: string; status: JobStatus };

/**
 * GET /api/generate/[id] (proxy) のレスポンス。
 * COMPLETED 時は output に GenerateOutput、FAILED 時は output.message にエラー文言。
 */
export type JobStatusResponse = {
  id: string;
  status: JobStatus;
  output?: GenerateOutput | GenerateError | { message?: string };
  /** RunPod 側の失敗理由 (例 "executionTimeout exceeded")。output とは別に入る */
  error?: string;
};

export const DEFAULT_ANCHOR = "KeshikiCeramic, texture";
