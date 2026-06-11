"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GLAZE_COLORS, type GlazeColor } from "@/lib/colors";

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const MAX_RADIUS = CX - 18;

type Filter = "all" | "light" | "medium" | "dark";

type WheelPoint = {
  color: GlazeColor;
  X: number;
  Y: number;
  Z: number;
  projX: number;
  projY: number;
  depth: number;
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "light", label: "明るめ" },
  { key: "medium", label: "中間" },
  { key: "dark", label: "暗め" },
];

function matchesFilter(p: WheelPoint, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "light") return p.color.hsl.l > 60;
  if (filter === "medium") return p.color.hsl.l >= 30 && p.color.hsl.l <= 60;
  if (filter === "dark") return p.color.hsl.l < 30;
  return true;
}

export default function ColorWheel({
  selected,
  onSelect,
}: {
  selected: GlazeColor | null;
  onSelect: (c: GlazeColor) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // HSL 二重円錐空間の 3D 座標（明度の両端で半径が 0 に収束する）
  const points = useMemo<WheelPoint[]>(
    () =>
      GLAZE_COLORS.map((c) => {
        const lightnessScale = 1 - Math.abs(c.hsl.l - 50) / 50;
        const r = (c.hsl.s / 100) * lightnessScale * MAX_RADIUS;
        const angleRad = (c.hsl.h * Math.PI) / 180;
        return {
          color: c,
          X: r * Math.sin(angleRad),
          Y: (c.hsl.l - 50) * 2.2,
          Z: r * Math.cos(angleRad),
          projX: 0,
          projY: 0,
          depth: 0,
        };
      }),
    []
  );

  // 回転状態はドラッグ操作で連続的に変わるため ref で保持する
  const rotRef = useRef({ x: -0.3, y: 0.8 });
  const dragRef = useRef({
    dragging: false,
    lastX: 0,
    lastY: 0,
    totalDist: 0,
  });
  const hoveredRef = useRef<WheelPoint | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !tooltip) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const selectedPoint =
      points.find((p) => p.color.id === selected?.id) ?? null;

    function projectPoints() {
      const { x: rotX, y: rotY } = rotRef.current;
      points.forEach((p) => {
        const x1 = p.X * Math.cos(rotY) - p.Z * Math.sin(rotY);
        const z1 = p.X * Math.sin(rotY) + p.Z * Math.cos(rotY);
        const y2 = p.Y * Math.cos(rotX) - z1 * Math.sin(rotX);
        const z2 = p.Y * Math.sin(rotX) + z1 * Math.cos(rotX);
        p.projX = CX + x1;
        p.projY = CY - y2;
        p.depth = z2;
      });
    }

    function drawWireframe(c: CanvasRenderingContext2D) {
      const { x: rotX, y: rotY } = rotRef.current;
      const topProjY = CY - 110 * Math.cos(rotX);
      const botProjY = CY + 110 * Math.cos(rotX);

      c.beginPath();
      c.moveTo(CX, topProjY);
      c.lineTo(CX, botProjY);
      c.strokeStyle = "rgba(31, 29, 26, 0.08)";
      c.lineWidth = 1;
      c.setLineDash([4, 4]);
      c.stroke();
      c.setLineDash([]);

      c.fillStyle = "rgba(31, 29, 26, 0.4)";
      c.font = "10px sans-serif";
      c.textAlign = "center";
      c.fillText("明 (White)", CX, topProjY - 6);
      c.fillText("暗 (Black)", CX, botProjY + 12);

      c.beginPath();
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const angle = (i * 2 * Math.PI) / steps;
        const wx = MAX_RADIUS * Math.sin(angle);
        const wz = MAX_RADIUS * Math.cos(angle);
        const x1 = wx * Math.cos(rotY) - wz * Math.sin(rotY);
        const z1 = wx * Math.sin(rotY) + wz * Math.cos(rotY);
        const y2 = -z1 * Math.sin(rotX);
        const px = CX + x1;
        const py = CY - y2;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.strokeStyle = "rgba(31, 29, 26, 0.05)";
      c.lineWidth = 1;
      c.stroke();
    }

    function drawWheel() {
      if (!ctx) return;
      projectPoints();
      ctx.clearRect(0, 0, SIZE, SIZE);
      drawWireframe(ctx);

      const hovered = hoveredRef.current;
      const sorted = [...points].sort((a, b) => a.depth - b.depth);

      sorted.forEach((p) => {
        const isFiltered = matchesFilter(p, filter);
        const t = (p.depth + 130) / 260;
        const depthFactor = Math.max(0.1, Math.min(1.0, t));

        if (isFiltered) {
          if (p === selectedPoint || p === hovered) return;
          ctx.beginPath();
          const size = 1.8 + depthFactor * 2.5;
          ctx.arc(p.projX, p.projY, size, 0, 2 * Math.PI);
          ctx.fillStyle = p.color.hex;
          ctx.fill();
          ctx.lineWidth = 0.5;
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 + depthFactor * 0.45})`;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, 1.5, 0, 2 * Math.PI);
          ctx.fillStyle = p.color.hex + "10";
          ctx.fill();
        }
      });

      if (hovered && matchesFilter(hovered, filter)) {
        ctx.beginPath();
        ctx.arc(hovered.projX, hovered.projY, 7, 0, 2 * Math.PI);
        ctx.fillStyle = hovered.color.hex;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(hovered.projX, hovered.projY, 9, 0, 2 * Math.PI);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.stroke();
      }

      if (selectedPoint) {
        ctx.beginPath();
        ctx.arc(selectedPoint.projX, selectedPoint.projY, 8, 0, 2 * Math.PI);
        ctx.fillStyle = selectedPoint.color.hex;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#1f1d1a";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(selectedPoint.projX, selectedPoint.projY, 5, 0, 2 * Math.PI);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }

    function updateTooltip(point: WheelPoint | null) {
      if (!tooltip) return;
      if (point) {
        tooltip.style.left = `${point.projX}px`;
        tooltip.style.top = `${point.projY - 18}px`;
        tooltip.classList.add("active");
        const img = tooltip.querySelector("img");
        if (img) img.src = point.color.path;
        const idEl = tooltip.querySelector(".tooltip-id");
        if (idEl) idEl.textContent = point.color.id;
        const hexEl = tooltip.querySelector(".tooltip-hex");
        if (hexEl) hexEl.textContent = point.color.hex.toUpperCase();
      } else {
        tooltip.classList.remove("active");
      }
    }

    function getClosestPoint(
      mx: number,
      my: number,
      maxDist = 8
    ): WheelPoint | null {
      let closest: WheelPoint | null = null;
      let minDist = maxDist;
      points.forEach((p) => {
        if (!matchesFilter(p, filter)) return;
        const dist = Math.hypot(p.projX - mx, p.projY - my);
        if (dist < minDist) {
          minDist = dist;
          closest = p;
        }
      });
      return closest;
    }

    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = {
        dragging: true,
        lastX: e.clientX,
        lastY: e.clientY,
        totalDist: 0,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag.dragging) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const prevHovered = hoveredRef.current;
        hoveredRef.current = getClosestPoint(mx, my, 10);
        canvas.style.cursor = hoveredRef.current ? "pointer" : "grab";
        if (hoveredRef.current !== prevHovered) {
          drawWheel();
          updateTooltip(hoveredRef.current);
        }
        return;
      }

      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      rotRef.current.y += dx * 0.007;
      rotRef.current.x += dy * 0.007;
      rotRef.current.x = Math.max(
        -Math.PI / 2.2,
        Math.min(Math.PI / 2.2, rotRef.current.x)
      );
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.totalDist += Math.hypot(dx, dy);
      drawWheel();
    };

    const onMouseUp = () => {
      dragRef.current.dragging = false;
    };

    const onMouseLeave = () => {
      if (hoveredRef.current) {
        hoveredRef.current = null;
        drawWheel();
        updateTooltip(null);
      }
    };

    const onClick = (e: MouseEvent) => {
      if (dragRef.current.totalDist > 5) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const target = getClosestPoint(mx, my, 12);
      if (target) onSelect(target.color);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("click", onClick);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    drawWheel();

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [points, filter, selected, onSelect]);

  return (
    <>
      <div className="wheel-controls">
        <div className="filter-chips">
          {FILTERS.map((f) => (
            <span
              key={f.key}
              className={`filter-chip ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </span>
          ))}
        </div>
      </div>

      <div className="color-wheel-container">
        <div className="color-wheel-wrapper">
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            className="color-wheel"
          />
          <div className="color-tooltip" ref={tooltipRef}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="glaze preview" />
            <div className="tooltip-id">-</div>
            <div className="tooltip-hex">-</div>
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
                <div className="selected-preview-title">選択中のテストピース</div>
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
              <div className="selected-preview-title">選択中のテストピース</div>
              <div className="selected-preview-id">-</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
