#!/usr/bin/env python3
"""MainTable (釉薬データベース xlsx) → public/data/glaze-index.json

使い方:
    python3 scripts/build-glaze-index.py "/path/to/MainTable_提供用 1.xlsx"

xlsx 本体は提供用データなのでリポジトリに入れない。生成物の JSON だけをコミットする。
約 850KB (gzip 後 110KB) あるので bundle には含めず、public/ から必要時に fetch する
(lib/glaze-index.ts)。
依存: openpyxl

索引の形:
    {
      "source": "<xlsx ファイル名>",
      "rows": <対象行数>,
      "entries": [
        { "c": "22131", "g": ["A02", "C13"], "i": [100001, 100002], "t": [1250, 0] },
        ...
      ]
    }

- c: 5 条件 (素地種類, 焼成雰囲気, 表面状態, 釉性状１, 釉性状２) のコード末尾 1 桁。
     不明 (空 / 98 / 99) は "?"。並びと意味の対応は lib/glaze-index.ts を参照。
- g: 釉名称コード (A01..G12) をソートしたもの。空なら釉名称なし。
- i: 画像ID を整数にしたもの (元は 8 桁ゼロ埋め文字列。復元は padStart(8, "0"))。
- t: i と同じ並びの焼成最高温度 (℃)。無い場合は 0。

対象は、画像ID があり、素地種類と焼成雰囲気が判明している行のみ
(v5 が生成に使える実在レシピと揃える。Step-1 で素地と雰囲気は必ず決まるので、
それらが不明な行は選ばれようがない)。
"""
import json
import os
import sys
from collections import defaultdict

import openpyxl

ATTR_COLS = ["素地種類", "焼成雰囲気", "表面状態", "釉性状１", "釉性状２"]
UNKNOWN = {None, "", "98", "99"}


def attr_char(v):
    if v in UNKNOWN:
        return "?"
    s = str(v).strip()
    if not s.isdigit() or len(s) != 2 or s[0] != "0":
        raise ValueError(f"unexpected attribute code: {v!r}")
    return s[1]


def main(path, out):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    hdr = next(rows)
    idx = {h: i for i, h in enumerate(hdr)}
    for c in ATTR_COLS + ["釉名称", "画像ID", "焼成最高温度"]:
        if c not in idx:
            raise SystemExit(f"column not found: {c}")

    groups = defaultdict(list)
    n = 0
    for r in rows:
        img = r[idx["画像ID"]]
        if not img:
            continue
        cond = "".join(attr_char(r[idx[c]]) for c in ATTR_COLS)
        if cond[0] == "?" or cond[1] == "?":
            continue
        n += 1
        raw = r[idx["釉名称"]]
        codes = tuple(sorted({c.strip() for c in str(raw).split(",") if c.strip()})) if raw else ()
        temp = r[idx["焼成最高温度"]]
        temp = int(temp) if isinstance(temp, (int, float)) and temp > 0 else 0
        groups[(cond, codes)].append((int(str(img).strip()), temp))

    entries = []
    for (cond, codes), pieces in sorted(groups.items()):
        pieces.sort()
        entries.append(
            {
                "c": cond,
                "g": list(codes),
                "i": [p[0] for p in pieces],
                "t": [p[1] for p in pieces],
            }
        )
    data = {"source": os.path.basename(path), "rows": n, "entries": entries}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"rows: {n}, entries: {len(entries)}, bytes: {os.path.getsize(out)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "public", "data", "glaze-index.json")
    main(sys.argv[1], out)
