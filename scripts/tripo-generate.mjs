#!/usr/bin/env node
// 形の 9 マスのうち回転体で作れない 4 つ (埴輪・バッグ・花・猫) の 3D モデルを Tripo で生成し、
// public/models/<key>.glb に保存する。
//
// 使い方:
//   TRIPO_API_KEY=... node scripts/tripo-generate.mjs                 # 4 つ全部
//   TRIPO_API_KEY=... node scripts/tripo-generate.mjs cat haniwa      # 指定したものだけ
//   オプション: --faces 3000 (面数上限 50〜20000)  --model P1-20260311  --seed 7
//              --texture (テクスチャも付ける。既定は素のメッシュ)  --dry (API を叩かず設定だけ表示)
//
// 元画像は形の 9 マスのサムネイル (public/shapes/white/<key>.jpg) をそのまま使う。
// モデルは P1 (低ポリ・きれいなトポロジ) で、アプリ側で釉薬マテリアルを着せるのでテクスチャは付けない。
//
// API 仕様 (2026-10-27 確認): https://developers.tripo3d.com/en/docs/introduction
//   POST /v3/files (multipart "file") → data.file_token
//   POST /v3/generation/image-to-model {input, model, face_limit, texture, pbr, ...} → data.task_id
//   GET  /v3/tasks/{task_id} → data.status (queued/running/success/failed/cancelled), data.output.model_url
//   GET  /v3/account/balance → data.balance / data.frozen
// 生成に成功したら lib/vessels.ts の MODEL_SHAPES[key].ready を true にすること。
//
// tripo-cli (npm i -g tripo-cli, `tripo login` 済み) が入っていれば、このスクリプトの代わりに
//   tripo make public/shapes/white/<key>.jpg --model tripo-p1 -p face_limit=3000 -p texture=false -p pbr=false -o <dir>
// でも同じものが作れる (2026-10-27 の初回生成はこちらで実施)。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://openapi.tripo3d.com/v3";
const SHAPES = ["haniwa", "handbag", "flower", "cat"];
const POLL_MS = 5000;
const POLL_LIMIT_MS = 15 * 60 * 1000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "models");

function parseArgs(argv) {
  const opts = { shapes: [], faces: 3000, model: "P1-20260311", seed: undefined, texture: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--faces") opts.faces = Number(argv[++i]);
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--seed") opts.seed = Number(argv[++i]);
    else if (a === "--texture") opts.texture = true;
    else if (a === "--dry") opts.dry = true;
    else if (SHAPES.includes(a)) opts.shapes.push(a);
    else throw new Error(`unknown argument: ${a} (shapes: ${SHAPES.join(", ")})`);
  }
  if (opts.shapes.length === 0) opts.shapes = [...SHAPES];
  return opts;
}

const apiKey = process.env.TRIPO_API_KEY;
const opts = parseArgs(process.argv.slice(2));

const headers = { Authorization: `Bearer ${apiKey}` };

async function api(method, p, body, isForm = false) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: isForm ? headers : { ...headers, "Content-Type": "application/json" },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${p}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.code !== 0) {
    throw new Error(
      `${method} ${p}: HTTP ${res.status} code=${json.code} ${json.message ?? ""} ${json.suggestion ?? ""} (request_id ${json.request_id ?? "-"})`
    );
  }
  return json.data;
}

async function balance() {
  const d = await api("GET", "/account/balance");
  return `${d.balance} (frozen ${d.frozen})`;
}

async function upload(file) {
  const bytes = await fs.readFile(file);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), path.basename(file));
  const d = await api("POST", "/files", form, true);
  return d.file_token;
}

async function createTask(fileToken) {
  const body = {
    input: fileToken,
    model: opts.model,
    face_limit: opts.faces,
    texture: opts.texture,
    pbr: opts.texture,
  };
  if (opts.seed !== undefined) body.model_seed = opts.seed;
  const d = await api("POST", "/generation/image-to-model", body);
  return d.task_id;
}

async function waitTask(taskId, label) {
  const started = Date.now();
  let lastLine = "";
  for (;;) {
    const d = await api("GET", `/tasks/${taskId}`);
    const line = `${label}: ${d.status} ${d.progress ?? 0}%`;
    if (line !== lastLine) {
      console.log(`  ${line}`);
      lastLine = line;
    }
    if (d.status === "success") return d;
    if (d.status === "failed" || d.status === "cancelled") {
      throw new Error(`${label}: ${d.status} (${d.error_code ?? "-"}) ${d.error_message ?? ""}`);
    }
    if (Date.now() - started > POLL_LIMIT_MS) throw new Error(`${label}: timeout`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  return buf.length;
}

async function main() {
  console.log(`shapes: ${opts.shapes.join(", ")} / model ${opts.model} / face_limit ${opts.faces} / texture ${opts.texture}`);
  if (opts.dry) return;
  if (!apiKey) throw new Error("TRIPO_API_KEY が未設定です (export TRIPO_API_KEY=... で渡す)");
  await fs.mkdir(outDir, { recursive: true });
  console.log(`balance before: ${await balance()}`);

  const results = [];
  for (const key of opts.shapes) {
    const image = path.join(root, "public", "shapes", "white", `${key}.jpg`);
    console.log(`\n[${key}] upload ${path.relative(root, image)}`);
    const token = await upload(image);
    const taskId = await createTask(token);
    console.log(`  task ${taskId}`);
    const task = await waitTask(taskId, key);
    const modelUrl = task.output?.model_url;
    if (!modelUrl) throw new Error(`${key}: output.model_url がありません ${JSON.stringify(task.output)}`);
    const dest = path.join(outDir, `${key}.glb`);
    const size = await download(modelUrl, dest);
    const meta = {
      key,
      task_id: taskId,
      model: opts.model,
      face_limit: opts.faces,
      texture: opts.texture,
      credits_consumed: task.credits_consumed ?? null,
      rendered_image_url: task.output?.rendered_image_url ?? null,
      generated_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(outDir, `${key}.json`), JSON.stringify(meta, null, 2) + "\n");
    console.log(`  saved ${path.relative(root, dest)} (${(size / 1024).toFixed(0)} KB, credits ${meta.credits_consumed ?? "?"})`);
    results.push(meta);
  }

  console.log(`\nbalance after: ${await balance()}`);
  console.log("done. lib/vessels.ts の MODEL_SHAPES で ready: true にしてください:", results.map((r) => r.key).join(", "));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
