// 本番システム (RunPod serverless ワーカー) への薄い proxy。
// ブラウザからの入力を { input: ... } にラップして非同期投入し、
// ジョブ id を返す。ステータス取得/キャンセルは /api/generate/[id] を参照。
// `?api=v5` で v5 endpoint (深度画像 → 器の画像)、`?api=3d` で 3D endpoint (画像 → GLB) に投げる。既定は従来の v3。
// `?sync=1` を付けると /runsync で結果まで待って返す (自由探索など数秒で返るもの向け。
// RunPod 側の待ち上限は 90 秒で、超えると IN_PROGRESS のまま返るので /api/generate/[id] で続きを取る)。

import {
  configMissingResponse,
  parseRunpodApi,
  runpodConfig,
} from "@/lib/runpod";

export async function POST(request: Request) {
  const api = parseRunpodApi(request);
  const config = runpodConfig(api);
  if (!config) return configMissingResponse(api);

  const input = await request.json();
  const sync = new URL(request.url).searchParams.get("sync") === "1";

  try {
    const res = await fetch(`${config.base}/${sync ? "runsync" : "run"}`, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify({ input }),
    });
    if (!res.ok) {
      return Response.json(
        { error: "pod_api_error", message: await res.text() },
        { status: 502 }
      );
    }
    const data = await res.json();
    // runsync は status/output/error まで入った job をそのまま返す
    return Response.json(sync ? data : { id: data.id, status: data.status });
  } catch (e) {
    return Response.json(
      { error: "pod_api_unreachable", message: String(e) },
      { status: 502 }
    );
  }
}
