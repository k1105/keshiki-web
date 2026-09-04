// RunPod serverless エンドポイント接続設定 (サーバー側でのみ使用)

const RUNPOD_BASE = "https://api.runpod.ai/v2";

export function runpodConfig() {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpointId || !apiKey) return null;
  return {
    base: `${RUNPOD_BASE}/${endpointId}`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  };
}

export const configMissingResponse = () =>
  Response.json(
    {
      error: "config_missing",
      message:
        "RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY が未設定です (.env.local に追加してください)",
    },
    { status: 503 }
  );
