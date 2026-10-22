// 焼成フローで「本番 endpoint に送ってよい追加機能」と「疑似応答 (モック) を使うか」の切り替え。
//
// v5 / 3D は知らないキーをエラーにする (ValueError → FAILED) ので、本番に反映されるまで
// preview / detail は送れない。反映されたらここの既定値を true にする (岸さんから連絡をもらう)。
//
// 切り替え方 (優先順: URL クエリ > 環境変数 > 既定値):
// - URL: ?mock=1 (疑似応答)、?mock=1&speed=4 (4 倍速)、?preview=1、?detail=1
// - 環境変数 (.env.local、ブラウザに埋め込むので NEXT_PUBLIC_ が必要。変えたら dev サーバー再起動):
//   NEXT_PUBLIC_FIRING_MOCK=1 / NEXT_PUBLIC_FIRING_MOCK_SPEED=4 / NEXT_PUBLIC_V5_PREVIEW=1 / NEXT_PUBLIC_3D_DETAIL=1

export type FiringCapabilities = {
  /** v5 に preview (生成途中の絵) を送る。本番未反映 (2026-10-19 時点) */
  preview: boolean;
  /** 3D に detail (途中の形) を送る。本番未反映 (2026-10-19 時点) */
  detail: boolean;
  /** API を叩かず疑似応答で焼成フローを動かす (演出の確認用) */
  mock: boolean;
  /** 疑似応答の進む速さ (1 = 仕様書の実測どおり、4 = 4 倍速) */
  mockSpeed: number;
};

// 本番反映前の既定値。反映されたら true に変える
const DEFAULT_PREVIEW = false;
const DEFAULT_DETAIL = false;

function flag(query: URLSearchParams | null, key: string, env: string | undefined, fallback: boolean): boolean {
  const q = query?.get(key);
  if (q === "1" || q === "true") return true;
  if (q === "0" || q === "false") return false;
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return fallback;
}

function number(query: URLSearchParams | null, key: string, env: string | undefined, fallback: number): number {
  const raw = query?.get(key) ?? env;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 現在の切り替え状態を読む (ブラウザでは URL クエリも見る。SSR では環境変数と既定値だけ) */
export function firingCapabilities(): FiringCapabilities {
  const query =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  // process.env.NEXT_PUBLIC_* はビルド時に文字列へ置き換わるので、そのままの名前で参照する
  return {
    preview: flag(query, "preview", process.env.NEXT_PUBLIC_V5_PREVIEW, DEFAULT_PREVIEW),
    detail: flag(query, "detail", process.env.NEXT_PUBLIC_3D_DETAIL, DEFAULT_DETAIL),
    mock: flag(query, "mock", process.env.NEXT_PUBLIC_FIRING_MOCK, false),
    mockSpeed: number(query, "speed", process.env.NEXT_PUBLIC_FIRING_MOCK_SPEED, 1),
  };
}
