// 本番システム (RunPod serverless ワーカー) への薄い proxy。
// ブラウザからの GenerateInput を { input: ... } にラップして非同期投入し、
// ジョブ id を返す。ステータス取得/キャンセルは /api/generate/[id] を参照。

import { configMissingResponse, runpodConfig } from "@/lib/runpod";

export async function POST(request: Request) {
  const config = runpodConfig();
  if (!config) return configMissingResponse();

  const input = await request.json();

  try {
    const res = await fetch(`${config.base}/run`, {
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
    return Response.json({ id: data.id, status: data.status });
  } catch (e) {
    return Response.json(
      { error: "pod_api_unreachable", message: String(e) },
      { status: 502 }
    );
  }
}
