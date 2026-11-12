// ジョブのステータス取得 (GET) とキャンセル (DELETE)。
// RunPod の /status/{id} /cancel/{id} をそのまま中継する。
// 投入時と同じ `?api=v5` を付けると v5 endpoint に問い合わせる。

import {
  configMissingResponse,
  parseRunpodApi,
  runpodConfig,
  upstreamStatus,
} from "@/lib/runpod";

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/generate/[id]">
) {
  const api = parseRunpodApi(req);
  const config = runpodConfig(api);
  if (!config) return configMissingResponse(api);

  const { id } = await ctx.params;
  try {
    const res = await fetch(`${config.base}/status/${id}`, {
      headers: config.headers,
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

export async function DELETE(
  req: Request,
  ctx: RouteContext<"/api/generate/[id]">
) {
  const api = parseRunpodApi(req);
  const config = runpodConfig(api);
  if (!config) return configMissingResponse(api);

  const { id } = await ctx.params;
  try {
    const res = await fetch(`${config.base}/cancel/${id}`, {
      method: "POST",
      headers: config.headers,
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
