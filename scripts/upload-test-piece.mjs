import { put, list } from "@vercel/blob";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SRC_DIR = "/Users/kanata/work/keshiki/public/test-piece/ok_1306";
const PREFIX = "test-piece/ok_1306/";
const CONCURRENCY = 10;

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set");
  process.exit(1);
}

// 既にアップロード済みのものはスキップ（再実行でレジューム可能にする）
const uploaded = new Set();
let cursor;
do {
  const res = await list({ prefix: PREFIX, limit: 1000, cursor });
  for (const b of res.blobs) uploaded.add(path.basename(b.pathname));
  cursor = res.cursor;
} while (cursor);

const files = (await readdir(SRC_DIR, { withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.startsWith("."))
  .map((e) => e.name)
  .sort();

const queue = files.filter((f) => !uploaded.has(f));
console.log(
  `total: ${files.length}, already uploaded: ${files.length - queue.length}, to upload: ${queue.length}`
);

let done = 0;
const failed = [];

async function worker() {
  while (queue.length > 0) {
    const name = queue.shift();
    try {
      const body = await readFile(path.join(SRC_DIR, name));
      await put(PREFIX + name, body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    } catch (err) {
      failed.push(name);
      console.error(`FAILED: ${name}: ${err.message}`);
    }
    done++;
    if (done % 50 === 0) console.log(`progress: ${done} done`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`finished: ${done - failed.length} uploaded, ${failed.length} failed`);
if (failed.length > 0) {
  console.log("failed files:", failed.join(", "));
  process.exit(1);
}
