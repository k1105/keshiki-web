"use client";

import { useState } from "react";
import { findClosestColor, hslToHex, type GlazeColor } from "@/lib/colors";

export default function HslSliderPicker({
  selected,
  onSelect,
}: {
  selected: GlazeColor | null;
  onSelect: (c: GlazeColor) => void;
}) {
  // スライダーは「指定したい色」を保持し、最も近いテストピースへ写像する
  const [h, setH] = useState(selected?.hsl.h ?? 160);
  const [s, setS] = useState(selected?.hsl.s ?? 35);
  const [l, setL] = useState(selected?.hsl.l ?? 45);

  const hex = hslToHex(h, s, l);

  const update = (nh: number, ns: number, nl: number) => {
    setH(nh);
    setS(ns);
    setL(nl);
    const closest = findClosestColor(hslToHex(nh, ns, nl));
    if (closest) onSelect(closest);
  };

  const hueStops = Array.from(
    { length: 13 },
    (_, i) => `hsl(${i * 30}, ${s}%, ${l}%)`
  ).join(", ");

  const rows = [
    {
      label: "色相 H",
      value: h,
      max: 360,
      unit: "°",
      bg: `linear-gradient(to right, ${hueStops})`,
      set: (v: number) => update(v, s, l),
    },
    {
      label: "彩度 S",
      value: s,
      max: 100,
      unit: "%",
      bg: `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`,
      set: (v: number) => update(h, v, l),
    },
    {
      label: "明度 L",
      value: l,
      max: 100,
      unit: "%",
      bg: `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`,
      set: (v: number) => update(h, s, v),
    },
  ];

  return (
    <div className="hsl-picker">
      <div className="hsl-sliders">
        {rows.map((row) => (
          <div className="hsl-slider-row" key={row.label}>
            <div className="hsl-slider-label">{row.label}</div>
            <input
              type="range"
              min={0}
              max={row.max}
              value={row.value}
              className="hsl-range"
              style={{ background: row.bg }}
              onChange={(e) => row.set(Number(e.target.value))}
            />
            <div className="hsl-value">
              {row.value}
              {row.unit}
            </div>
          </div>
        ))}

        <div className="hsl-spec-row">
          <span className="hsl-spec-swatch" style={{ backgroundColor: hex }} />
          <span className="hsl-spec-text">
            指定した色 <code>{hex}</code> に最も近いテストピースを選択します
          </span>
        </div>
      </div>

      <div className="selected-preview">
        {selected ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.path}
              className="selected-preview-img"
              alt="Selected Glaze"
            />
            <div className="selected-preview-info">
              <div className="selected-preview-title">
                最も近いテストピース
              </div>
              <div className="selected-preview-id">{selected.id}.JPG</div>
              <div className="selected-preview-meta">
                <span>
                  カラー:{" "}
                  <span
                    className="selected-preview-hex"
                    style={{
                      backgroundColor: selected.hex,
                      color: selected.hsl.l > 60 ? "#1f1d1a" : "#ffffff",
                    }}
                  >
                    {selected.hex.toLowerCase()}
                  </span>
                </span>
                <span className="selected-preview-hsl">
                  HSL: {selected.hsl.h}°, {selected.hsl.s}%, {selected.hsl.l}%
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="selected-preview-info">
            <div className="selected-preview-title">最も近いテストピース</div>
            <div className="selected-preview-id">-</div>
          </div>
        )}
      </div>
    </div>
  );
}
