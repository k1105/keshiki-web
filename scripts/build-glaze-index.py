#!/usr/bin/env python3
"""MainTable (釉薬データベース xlsx) → public/data/glaze-index.json

使い方:
    python3 scripts/build-glaze-index.py "/path/to/MainTable_提供用 1.xlsx"

xlsx 本体は提供用データなのでリポジトリに入れない。生成物の JSON だけをコミットする。
約 850KB (gzip 後 110KB) あるので bundle には含めず、public/ から必要時に fetch する
(lib/glaze-index.ts)。
依存: openpyxl, colour-science, scipy (色の換算に使う。keshiki/venv に入っている)

索引の形:
    {
      "source": "<xlsx ファイル名>",
      "rows": <対象行数>,
      "entries": [
        { "c": "22131", "g": ["A02", "C13"], "i": [100001, 100002], "t": [1250, 0], "k": ["6e6357", null] },
        ...
      ]
    }

- c: 5 条件 (素地種類, 焼成雰囲気, 表面状態, 釉性状１, 釉性状２) のコード末尾 1 桁。
     不明 (空 / 98 / 99) は "?"。並びと意味の対応は lib/glaze-index.ts を参照。
- g: 釉名称コード (A01..G12) をソートしたもの。空なら釉名称なし。
- i: 画像ID を整数にしたもの (元は 8 桁ゼロ埋め文字列。復元は padStart(8, "0"))。
- t: i と同じ並びの焼成最高温度 (℃)。無い場合は 0。
- k: i と同じ並びの代表色 (sRGB hex、"#" なし)。DB のマンセル値 (H = ASTM 色相番号 0〜100, V, c) を
     colour-science の Munsell 再表色データで換算したもの。マンセル値が無い行は null。
     釉薬を選んだときに器のプレビューへ載せる色に使う (lib/glaze-index.ts representativeGlazeColor)。

対象は、画像ID があり、素地種類と焼成雰囲気が判明している行のみ
(v5 が生成に使える実在レシピと揃える。Step-1 で素地と雰囲気は必ず決まるので、
それらが不明な行は選ばれようがない)。
"""
import json
import os
import sys
from collections import defaultdict

import openpyxl

try:
    import numpy as np
    import colour
    from colour.notation.munsell import luminance_ASTMD1535, munsell_specification_to_xyY
except ImportError as e:  # pragma: no cover
    raise SystemExit(f"colour-science / scipy が必要です (pip install colour-science scipy): {e}")

ILLUMINANT_C = colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["C"]
_hex_cache = {}


def munsell_to_hex(h, v, c):
    """DB の H (ASTM 色相番号 0〜100) / V / c → sRGB hex ("#" なし)。換算できなければ None。

    ASTM 色相番号 → Colorlab 仕様 (hue 0〜10, code) は colour の hue_to_ASTM_hue の逆:
    ASTM = 10 * ((7 - code) % 10) + hue。再表色データの範囲外 (彩度が高すぎる) は彩度を落として再試行する。
    """
    try:
        h, v, c = float(h), float(v), float(c)
    except (TypeError, ValueError):
        return None
    if not (0 <= v <= 10) or c < 0:
        return None
    key = (round(h, 1), round(v, 1), round(c, 1))
    if key in _hex_cache:
        return _hex_cache[key]
    a = h % 100
    if a == 0:
        a = 100
    k = int((a - 1e-9) // 10)
    hue = a - 10 * k
    code = (7 - k) % 10 or 10
    result = None
    for factor in (1.0, 0.8, 0.6, 0.4, 0.2, 0.0):
        chroma = c * factor
        try:
            if chroma < 0.05:
                xyY = np.array([ILLUMINANT_C[0], ILLUMINANT_C[1], luminance_ASTMD1535(v) / 100])
            else:
                xyY = munsell_specification_to_xyY([hue, v, chroma, code])
            rgb = np.clip(colour.XYZ_to_sRGB(colour.xyY_to_XYZ(xyY), illuminant=ILLUMINANT_C), 0, 1)
            result = "%02x%02x%02x" % tuple(int(round(x * 255)) for x in rgb)
            break
        except Exception:
            continue
    _hex_cache[key] = result
    return result

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
    for c in ATTR_COLS + ["釉名称", "画像ID", "焼成最高温度", "H", "V", "c"]:
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
        hv = (r[idx["H"]], r[idx["V"]], r[idx["c"]])
        color = munsell_to_hex(*hv) if all(x not in (None, "") for x in hv) else None
        groups[(cond, codes)].append((int(str(img).strip()), temp, color))

    entries = []
    for (cond, codes), pieces in sorted(groups.items()):
        pieces.sort()
        entries.append(
            {
                "c": cond,
                "g": list(codes),
                "i": [p[0] for p in pieces],
                "t": [p[1] for p in pieces],
                "k": [p[2] for p in pieces],
            }
        )
    colored = sum(1 for e in entries for k in e["k"] if k)
    data = {"source": os.path.basename(path), "rows": n, "entries": entries}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"rows: {n} (with color: {colored}), entries: {len(entries)}, bytes: {os.path.getsize(out)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "public", "data", "glaze-index.json")
    main(sys.argv[1], out)
