"use client";

import { useEffect } from "react";
import VesselCanvas from "./VesselCanvas";
import { additivesForColor, thicknessDesc } from "@/lib/recipe";
import type { GlazeColor } from "@/lib/colors";
import type { CustomVessel, VesselShape } from "@/lib/vessels";

export type FiringModalProps = {
  open: boolean;
  onClose: () => void;
  shape: VesselShape;
  custom?: CustomVessel | null;
  glaze: GlazeColor | null;
  clay: string;
  atmosphere: string;
  temp: number;
  thickness: number;
  gloss: number;
  tone: number;
};

export default function FiringModal({
  open,
  onClose,
  shape,
  custom = null,
  glaze,
  clay,
  atmosphere,
  temp,
  thickness,
  gloss,
  tone,
}: FiringModalProps) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const additives = glaze
    ? additivesForColor(glaze.hsl)
    : [{ key: "無添加 (透明釉ベース)", val: "-" }];

  return (
    <div className={`firing-modal ${open ? "active" : ""}`}>
      <div className="firing-modal-overlay" onClick={onClose} />
      <div className="firing-modal-content">
        <button className="firing-modal-close" onClick={onClose}>
          &times;
        </button>
        <h2>焼成結果</h2>
        <p className="sub">生成された釉薬レシピと焼き上がりイメージです。</p>

        <div className="result">
          <div className="result-visual">
            {open && (
              <VesselCanvas
                shape={shape}
                custom={custom}
                texturePath={glaze?.path ?? null}
                hex={glaze?.hex ?? null}
                gloss={gloss}
                tone={tone}
              />
            )}
          </div>
          <div className="recipe">
            <div className="recipe-block">
              <div className="rb-ttl">基礎釉</div>
              <div className="recipe-row"><span className="key">長石</span><span className="val">40</span></div>
              <div className="recipe-row"><span className="key">石灰石</span><span className="val">15</span></div>
              <div className="recipe-row"><span className="key">珪石</span><span className="val">25</span></div>
              <div className="recipe-row"><span className="key">カオリン</span><span className="val">10</span></div>
              <div className="recipe-row"><span className="key">フリット</span><span className="val">10</span></div>
              <div className="recipe-row"><span className="key total">合計</span><span className="val total">100</span></div>
            </div>

            <div className="recipe-block">
              <div className="rb-ttl">添加物</div>
              {additives.map((a) => (
                <div className="recipe-row" key={a.key}>
                  <span className="key">{a.key}</span>
                  <span className="val">{a.val}</span>
                </div>
              ))}
            </div>

            <div className="recipe-block">
              <div className="rb-ttl">焼成条件</div>
              <div className="recipe-row">
                <span className="key">素地</span>
                <span className="val">
                  {clay === "陶器" ? "陶器 (白土〜半磁器土)" : "磁器 (磁器土)"}
                </span>
              </div>
              <div className="recipe-row">
                <span className="key">焼成温度</span>
                <span className="val">{temp}℃前後</span>
              </div>
              <div className="recipe-row">
                <span className="key">焼成雰囲気</span>
                <span className="val">{atmosphere}</span>
              </div>
              <div className="recipe-row">
                <span className="key">施釉</span>
                <span className="val">{thicknessDesc(thickness)}</span>
              </div>
              <div className="recipe-row">
                <span className="key">テストピース</span>
                <span className="val">{glaze ? `${glaze.id}.JPG` : "-"}</span>
              </div>
            </div>

            <div className="recipe-block">
              <div className="rb-ttl">ゼーゲル式（概算）</div>
              <div className="recipe-row"><span className="key">KNaO</span><span className="val">0.30</span></div>
              <div className="recipe-row"><span className="key">CaO</span><span className="val">0.45</span></div>
              <div className="recipe-row"><span className="key">MgO</span><span className="val">0.05</span></div>
              <div className="recipe-row"><span className="key">B₂O₃</span><span className="val">0.20</span></div>
              <div className="recipe-row"><span className="key">Al₂O₃</span><span className="val">0.35</span></div>
              <div className="recipe-row"><span className="key">SiO₂</span><span className="val">3.20</span></div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button
            className="btn primary"
            onClick={onClose}
            style={{ padding: "12px 36px", minWidth: 120 }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
