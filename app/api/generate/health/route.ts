// endpoint の稼働状況 (GET)。RunPod の /health をそのまま中継する。
// 応答は { jobs: {...}, workers: { idle, initializing, ready, running, throttled, unhealthy } }。
// ジョブが順番待ちのまま進まないとき、worker が 1 台もいないのかをフロントが見分けるのに使う
// (lib/endpoint-health.ts)。`?api=v5` / `?api=3d` で対象を選ぶ。既定は従来の v3。

import {
  configMissingResponse,
  parseRunpodApi,
  runpodConfig,
  upstreamStatus,
} from "@/lib/runpod";

export async function GET(request: Request) {
  const api = parseRunpodApi(request);
  const config = runpodConfig(api);
  if (!config) return configMissingResponse(api);

  try {
    const res = await fetch(`${config.base}/health`, {
      headers: config.headers,
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json(
        { error: "pod_api_error", message: await res.text() },
        { status: upstreamStatus(res.status) }
      );
    }
    return Response.json(await res.json());
  } catch (e) {
    return Response.json(
      { error: "pod_api_unreachable", message: String(e) },
      { status: 502 }
    );
  }
}
