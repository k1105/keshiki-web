// 生成サーバー (RunPod endpoint) が動いていないことを早めに見分ける。
//
// ジョブが IN_QUEUE のまま進まないとき、理由は 2 つある:
//   a. worker を確保・起動している最中 (待てば始まる。cold だと数十秒〜数分)
//   b. worker が 1 台もいない (待っても始まらない。endpoint の worker 上限が 0、残高切れなど)
// /status だけでは見分けられないので、順番待ちが続いたら /health の worker 数を見る。
// 2026-11-12 の実測: b のとき workers は idle / initializing / ready / running / throttled が
// すべて 0 のままで、ジョブは何分待っても IN_QUEUE だった。
//
// 判定: 順番待ちが FIRST_CHECK_MS 続いたら CHECK_EVERY_MS ごとに /health を見て、
// 「worker がいない」が NEEDED_MISSES 回続いたら動いていないとみなす (投入から約 20 秒)。
// 起動中 (initializing) や確保待ち (throttled) の worker が 1 台でもいれば a なので待ち続ける。
// /health が取れなかった回は数えない (判定できないときは今までどおり待つ)。

export type EndpointHealth = {
  workers?: Partial<
    Record<"idle" | "initializing" | "ready" | "running" | "throttled" | "unhealthy", number>
  >;
};

/** worker がいないとみなしたときの GenerateError.error */
export const NO_WORKERS = "no_workers";

const FIRST_CHECK_MS = 10 * 1000;
const CHECK_EVERY_MS = 5 * 1000;
const NEEDED_MISSES = 3;

/** /api/generate/health を取る。取れなかったら null */
export async function fetchEndpointHealth(
  api: "v5" | "3d",
  signal?: AbortSignal
): Promise<EndpointHealth | null> {
  try {
    const res = await fetch(`/api/generate/health?api=${api}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as EndpointHealth;
  } catch {
    return null;
  }
}

/** ジョブを受け取れる (か、受け取れるようになる見込みの) worker が 1 台でもいるか。読めなければ null */
export function hasWorkers(health: EndpointHealth | null): boolean | null {
  const w = health?.workers;
  if (!w || typeof w !== "object") return null;
  const count =
    (w.idle ?? 0) + (w.initializing ?? 0) + (w.ready ?? 0) + (w.running ?? 0) + (w.throttled ?? 0);
  return count > 0;
}

export type QueueWatch = {
  /** ジョブが IN_QUEUE だと分かるたびに呼ぶ。true が返ったら worker がいない (待っても始まらない) */
  queued(): Promise<boolean>;
};

/** 1 つのジョブの順番待ちを見張る。ジョブごとに作る */
export function createQueueWatch(getHealth: () => Promise<EndpointHealth | null>): QueueWatch {
  let queuedSince: number | null = null;
  let lastCheck = 0;
  let misses = 0;
  return {
    async queued() {
      const now = Date.now();
      if (queuedSince === null) queuedSince = now;
      if (now - queuedSince < FIRST_CHECK_MS || now - lastCheck < CHECK_EVERY_MS) return false;
      lastCheck = now;
      const alive = hasWorkers(await getHealth());
      if (alive === null) return false;
      misses = alive ? 0 : misses + 1;
      return misses >= NEEDED_MISSES;
    },
  };
}
