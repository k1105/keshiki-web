// ジョブのステータス取得 (GET) とキャンセル (DELETE)。
// RunPod の /status/{id} /cancel/{id} をそのまま中継する。

import { configMissingResponse, runpodConfig } from "@/lib/runpod";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/generate/[id]">
) {
  const config = runpodConfig();
  if (!config) return configMissingResponse();

  const { id } = await ctx.params;
  try {
    const res = await fetch(`${config.base}/status/${id}`, {
      headers: config.headers,
    });
    if (!res.ok) {
      return Response.json(
        { error: "pod_api_error", message: await res.text() },
        { status: 502 }
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
  _req: Request,
  ctx: RouteContext<"/api/generate/[id]">
) {
  const config = runpodConfig();
  if (!config) return configMissingResponse();

  const { id } = await ctx.params;
  try {
    const res = await fetch(`${config.base}/cancel/${id}`, {
      method: "POST",
      headers: config.headers,
    });
    if (!res.ok) {
      return Response.json(
        { error: "pod_api_error", message: await res.text() },
        { status: 502 }
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
