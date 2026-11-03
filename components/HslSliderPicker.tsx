"use client";

import { useEffect, useRef, useState } from "react";
import { findClosestColor, hslToHex, type GlazeColor } from "@/lib/colors";

export default function HslSliderPicker({
  selected,
  onSelect,
  onPreviewColor,
  labels,
}: {
  selected: GlazeColor | null;
  onSelect: (c: GlazeColor) => void;
  // 編集中の「指定した色」を通知する。null で編集モード終了
  onPreviewColor?: (hex: string | null) => void;
  labels: { hue: string; saturation: string; lightness: string };
}) {
  // スライダーは「指定したい色」を保持し、最も近いテストピースへ写像する
  const [h, setH] = useState(selected?.hsl.h ?? 160);
  const [s, setS] = useState(selected?.hsl.s ?? 35);
  const [l, setL] = useState(selected?.hsl.l ?? 45);

  const hex = hslToHex(h, s, l);

  // 編集モードに入った時点で指定色をプレビューへ、抜けるときに解除
  const previewRef = useRef(onPreviewColor);
  previewRef.current = onPreviewColor;
  const initialHexRef = useRef(hex);
  useEffect(() => {
    previewRef.current?.(initialHexRef.current);
    return () => previewRef.current?.(null);
  }, []);

  const update = (nh: number, ns: number, nl: number) => {
    setH(nh);
    setS(ns);
    setL(nl);
    onPreviewColor?.(hslToHex(nh, ns, nl));
    const closest = findClosestColor(hslToHex(nh, ns, nl));
    if (closest) onSelect(closest);
  };

  // 各スライダーがどれ (H / S / L) なのか分かるように、頭文字と名前・現在値を添える
  const rows = [
    { short: "H", label: labels.hue, value: h, max: 360, unit: "°", set: (v: number) => update(v, s, l) },
    { short: "S", label: labels.saturation, value: s, max: 100, unit: "%", set: (v: number) => update(h, v, l) },
    { short: "L", label: labels.lightness, value: l, max: 100, unit: "%", set: (v: number) => update(h, s, v) },
  ];

  return (
    <div className="hsl-sliders">
      {rows.map((row) => (
        <label className="slider-row" key={row.short}>
          <span className="slider-label">
            <span>
              <span className="slider-short">{row.short}</span> {row.label}
            </span>
            <span>
              {row.value}
              {row.unit}
            </span>
          </span>
          <input
            type="range"
            className="slider"
            min={0}
            max={row.max}
            value={row.value}
            aria-label={row.label}
            onChange={(e) => row.set(Number(e.target.value))}
          />
        </label>
      ))}
    </div>
  );
}
