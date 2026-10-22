// RunPod serverless エンドポイント接続設定 (サーバー側でのみ使用)
//
// v3: 従来のテストピース t2i (RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY)
// v5: 深度画像 → 器の画像 (RUNPOD_V5_ENDPOINT_ID / RUNPOD_V5_API_KEY)。
//     v5 の key が空なら v3 の key を使う (同じ key に権限追加される想定)
// 3d: 器の画像 → GLB (RUNPOD_3D_ENDPOINT_ID)。key は v5 と同じものを使う (docs/api/serverless_api_3d.md)

const RUNPOD_BASE = "https://api.runpod.ai/v2";

export type RunpodApi = "v3" | "v5" | "3d";

export function parseRunpodApi(request: Request): RunpodApi {
  const api = new URL(request.url).searchParams.get("api");
  return api === "v5" || api === "3d" ? api : "v3";
}

export function runpodConfig(api: RunpodApi = "v3") {
  const endpointId =
    api === "v5"
      ? process.env.RUNPOD_V5_ENDPOINT_ID
      : api === "3d"
        ? process.env.RUNPOD_3D_ENDPOINT_ID
        : process.env.RUNPOD_ENDPOINT_ID;
  const apiKey =
    (api !== "v3" ? process.env.RUNPOD_V5_API_KEY : undefined) ||
    process.env.RUNPOD_API_KEY;
  if (!endpointId || !apiKey) return null;
  return {
    base: `${RUNPOD_BASE}/${endpointId}`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  };
}

export const configMissingResponse = (api: RunpodApi = "v3") =>
  Response.json(
    {
      error: "config_missing",
      message:
        api === "v5"
          ? "RUNPOD_V5_ENDPOINT_ID / RUNPOD_API_KEY が未設定です (.env.local に追加してください)"
          : api === "3d"
            ? "RUNPOD_3D_ENDPOINT_ID / RUNPOD_API_KEY が未設定です (.env.local に追加してください)"
            : "RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY が未設定です (.env.local に追加してください)",
    },
    { status: 503 }
  );
