// RunPod のジョブ (投入 / 状態取得 / キャンセル) を叩く口。
// 本番は /api/generate (proxy) 経由。疑似応答 (lib/firing-mock.ts) も同じ形で差し替えられる。

import type { GenerateError, JobStatus } from "./glaze_prompt";

export type JobApi = "v5" | "3d";

/** /status の応答。output の中身は api ごとに違うので呼び出し側で判定する */
export type JobStatusAny = {
  id: string;
  status: JobStatus;
  output?: unknown;
  error?: string;
};

export type JobFailure = {
  ok: false;
  /** HTTP ステータス。503 = endpoint 未設定 (config_missing) */
  status: number;
  error: GenerateError;
};

export type SubmitResult = { ok: true; id: string } | JobFailure;
export type StatusResult = { ok: true; data: JobStatusAny } | JobFailure;

export type JobClient = {
  submit(api: JobApi, input: unknown, signal?: AbortSignal): Promise<SubmitResult>;
  status(api: JobApi, id: string, signal?: AbortSignal): Promise<StatusResult>;
  /** 投げっぱなし (結果は待たない) */
  cancel(api: JobApi, id: string): void;
};

const query = (api: JobApi) => `?api=${api}`;

async function readError(res: Response): Promise<GenerateError> {
  try {
    const data = (await res.json()) as Partial<GenerateError>;
    if (data && typeof data.error === "string") return data as GenerateError;
  } catch {
    // JSON でない応答 (proxy より手前のエラーページなど)
  }
  return { error: `http_${res.status}` };
}

/** /api/generate 経由で RunPod を叩く本番用クライアント */
export const liveJobClient: JobClient = {
  async submit(api, input, signal) {
    try {
      const res = await fetch(`/api/generate${query(api)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
      const data = (await res.json()) as { id?: string };
      if (!data.id) return { ok: false, status: res.status, error: { error: "no_job_id" } };
      return { ok: true, id: data.id };
    } catch (e) {
      if (signal?.aborted) throw e;
      return { ok: false, status: 0, error: { error: "pod_api_unreachable", message: String(e) } };
    }
  },
  async status(api, id, signal) {
    try {
      const res = await fetch(`/api/generate/${id}${query(api)}`, { signal });
      if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
      return { ok: true, data: (await res.json()) as JobStatusAny };
    } catch (e) {
      if (signal?.aborted) throw e;
      return { ok: false, status: 0, error: { error: "pod_api_unreachable", message: String(e) } };
    }
  },
  cancel(api, id) {
    fetch(`/api/generate/${id}${query(api)}`, { method: "DELETE" }).catch(() => {});
  },
};
