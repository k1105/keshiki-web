"use client";

import { useState } from "react";
import ColorWheel from "@/components/ColorWheel";
import FiringModal from "@/components/FiringModal";
import HslSliderPicker from "@/components/HslSliderPicker";
import ProfileSketcher from "@/components/ProfileSketcher";
import VesselCanvas from "@/components/VesselCanvas";
import { findClosestColor, type GlazeColor } from "@/lib/colors";
import {
  CONCRETE_SHAPES,
  SHAPE_OPTIONS,
  type CustomVessel,
  type ShapeKey,
  type VesselShape,
} from "@/lib/vessels";

const STEPS = [
  { n: 1, ttl: "形を選ぶ" },
  { n: 2, ttl: "つくり方を選ぶ" },
  { n: 3, ttl: "焼き方を選ぶ" },
  { n: 4, ttl: "調整", small: "Step 4 (option)" },
];

function ShapeIcon({ shape }: { shape: ShapeKey | "random" }) {
  switch (shape) {
    case "vase":
      return (
        <svg viewBox="0 0 60 70">
          <ellipse cx="30" cy="46" rx="22" ry="22" fill="#1f1d1a" />
          <rect x="24" y="10" width="12" height="20" fill="#1f1d1a" />
          <ellipse cx="30" cy="10" rx="9" ry="3" fill="#1f1d1a" />
        </svg>
      );
    case "mug":
      return (
        <svg viewBox="0 0 60 70">
          <rect x="14" y="20" width="28" height="36" rx="2" fill="#1f1d1a" />
          <path d="M42 28 Q54 32 42 48" stroke="#1f1d1a" strokeWidth="4" fill="none" />
        </svg>
      );
    case "plate":
      return (
        <svg viewBox="0 0 60 70">
          <path d="M10 30 Q30 50 50 30 L46 56 L14 56 Z" fill="#1f1d1a" />
          <rect x="22" y="56" width="16" height="6" fill="#1f1d1a" />
        </svg>
      );
    case "teapot":
      return (
        <svg viewBox="0 0 60 70">
          <ellipse cx="30" cy="42" rx="18" ry="14" fill="#1f1d1a" />
          <path d="M14 42 Q4 36 8 28" stroke="#1f1d1a" strokeWidth="4" fill="none" />
          <rect x="20" y="22" width="20" height="10" rx="2" fill="#1f1d1a" />
        </svg>
      );
    case "yunomi":
      return (
        <svg viewBox="0 0 60 70">
          <path d="M14 30 L46 30 L42 58 L18 58 Z" fill="#1f1d1a" />
        </svg>
      );
    case "bowl":
      return (
        <svg viewBox="0 0 60 70">
          <ellipse cx="30" cy="44" rx="24" ry="10" fill="#1f1d1a" />
          <path d="M6 44 Q30 30 54 44" stroke="#1f1d1a" strokeWidth="2" fill="none" />
        </svg>
      );
    case "random":
      return (
        <svg viewBox="0 0 60 70">
          <text x="30" y="50" textAnchor="middle" fontSize="40" fill="#1f1d1a">
            ?
          </text>
        </svg>
      );
  }
}

function ChipGroup({
  items,
  selected,
  onSelect,
  className = "chips",
}: {
  items: string[];
  selected: string;
  onSelect: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      {items.map((item) => (
        <div
          key={item}
          className={`chip ${selected === item ? "selected" : ""}`}
          onClick={() => onSelect(item)}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

type Mode = "visual" | "style" | "mood";
type ShapeMode = "preset" | "draw";
type ColorMode = "wheel" | "slider";

export default function Home() {
  const [step, setStep] = useState(1);
  const [shape, setShape] = useState<VesselShape>("vase");
  const [shapeLabel, setShapeLabel] = useState("花瓶");
  const [selectedShapeOption, setSelectedShapeOption] = useState<
    ShapeKey | "random" | null
  >("vase");
  const [shapeMode, setShapeMode] = useState<ShapeMode>("preset");
  const [customVessel, setCustomVessel] = useState<CustomVessel | null>(null);
  const [glaze, setGlaze] = useState<GlazeColor | null>(() =>
    findClosestColor("#2f6d5f")
  );
  const [colorMode, setColorMode] = useState<ColorMode>("wheel");

  const [mode, setMode] = useState<Mode>("visual");
  const [expression, setExpression] = useState("なめらか");
  const [transparency, setTransparency] = useState(35);
  const [glossiness, setGlossiness] = useState(70);
  const [styleName, setStyleName] = useState("青磁釉");
  const [styleColor, setStyleColor] = useState("銅青磁釉");
  const [styleTexture, setStyleTexture] = useState("貫入釉");
  const [mood, setMood] = useState(
    "きょうは雨上がりの森みたいな、静かで少し湿った感じな気分です。"
  );

  const [clay, setClay] = useState("陶器");
  const [atmosphere, setAtmosphere] = useState("還元焼成");

  const [tone, setTone] = useState(60);
  const [gloss, setGloss] = useState(70);
  const [flow, setFlow] = useState(30);
  const [crackle, setCrackle] = useState(50);
  const [temp, setTemp] = useState(1230);
  const [thickness, setThickness] = useState(55);

  const [modalOpen, setModalOpen] = useState(false);

  const goTo = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pickShape = (key: ShapeKey | "random", name: string) => {
    setSelectedShapeOption(key);
    setShapeLabel(name);
    if (key === "random") {
      setShape(
        CONCRETE_SHAPES[Math.floor(Math.random() * CONCRETE_SHAPES.length)]
      );
    } else {
      setShape(key);
    }
  };

  const pickCustomShape = (v: CustomVessel) => {
    setCustomVessel(v);
    setShape("custom");
    setShapeLabel("自由形状（一筆描き）");
    setSelectedShapeOption(null);
  };

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <span className="dot" />
          keshiki — 釉薬焼成シミュレーター
        </div>
        <div className="meta">prototype v0.2 (Next.js)</div>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className={`step ${step === s.n ? "active" : ""} ${step > s.n ? "done" : ""}`}
            onClick={() => goTo(s.n)}
          >
            <div className="num">{s.n}</div>
            <div className="label">
              <span className="small">{s.small ?? `Step ${s.n}`}</span>
              <span className="ttl">{s.ttl}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="app-layout">
        <div className="app-main">
          {/* Step 1: 形 */}
          <div className={`panel ${step === 1 ? "active" : ""}`}>
            <h2>形を選ぶ</h2>
            <p className="sub">焼き上がりの器の形を選びます。</p>

            <div className="filter-chips picker-tabs">
              <span
                className={`filter-chip ${shapeMode === "preset" ? "active" : ""}`}
                onClick={() => setShapeMode("preset")}
              >
                プリセットから選ぶ
              </span>
              <span
                className={`filter-chip ${shapeMode === "draw" ? "active" : ""}`}
                onClick={() => setShapeMode("draw")}
              >
                一筆描きでつくる
              </span>
            </div>

            {shapeMode === "preset" ? (
              <div className="shapes">
                {SHAPE_OPTIONS.map((opt) => (
                  <div
                    key={opt.key}
                    className={`shape-card ${selectedShapeOption === opt.key ? "selected" : ""}`}
                    onClick={() => pickShape(opt.key, opt.name)}
                  >
                    <ShapeIcon shape={opt.key} />
                    <div className="shape-name">{opt.name}</div>
                  </div>
                ))}
              </div>
            ) : (
              <ProfileSketcher onShapeDrawn={pickCustomShape} />
            )}

            <div className="nav">
              <div />
              <button className="btn primary" onClick={() => goTo(2)}>
                つくり方を選ぶ →
              </button>
            </div>
          </div>

          {/* Step 2: つくり方 */}
          <div className={`panel ${step === 2 ? "active" : ""}`}>
            <h2>つくり方を選ぶ</h2>
            <p className="sub">3つのアプローチから、あなたに合う方法を選んでください。</p>

            <div className="modes">
              <div
                className={`mode-card ${mode === "visual" ? "active" : ""}`}
                onClick={() => setMode("visual")}
              >
                <div className="mode-ttl">見た目からつくる</div>
                <div className="mode-desc">
                  色・質感・透明度などビジュアルで指定（わかりやすさ）
                </div>
              </div>
              <div
                className={`mode-card ${mode === "style" ? "active" : ""}`}
                onClick={() => setMode("style")}
              >
                <div className="mode-ttl">釉薬スタイルからつくる</div>
                <div className="mode-desc">
                  伝統名称や仕上がり質感から選ぶ（専門性）
                </div>
              </div>
              <div
                className={`mode-card ${mode === "mood" ? "active" : ""}`}
                onClick={() => setMode("mood")}
              >
                <div className="mode-ttl">気分からつくる</div>
                <div className="mode-desc">
                  言葉で気分を伝えるとAIが解釈（AIらしさ）
                </div>
              </div>
            </div>

            {/* Mode A: Visual */}
            <div className={`mode-body ${mode === "visual" ? "active" : ""}`}>
              <div className="field">
                <div className="field-label">
                  <span className="num-badge">1</span>色を選ぶ
                  <span className="field-hint">
                    （テストピース画像から抽出した1283色）
                  </span>
                </div>
                <div className="filter-chips picker-tabs">
                  <span
                    className={`filter-chip ${colorMode === "wheel" ? "active" : ""}`}
                    onClick={() => setColorMode("wheel")}
                  >
                    色相環から選ぶ
                  </span>
                  <span
                    className={`filter-chip ${colorMode === "slider" ? "active" : ""}`}
                    onClick={() => setColorMode("slider")}
                  >
                    HSLスライダーで選ぶ
                  </span>
                </div>
                {colorMode === "wheel" ? (
                  <ColorWheel selected={glaze} onSelect={setGlaze} />
                ) : (
                  <HslSliderPicker selected={glaze} onSelect={setGlaze} />
                )}
              </div>

              <div className="field">
                <div className="field-label">
                  <span className="num-badge">2</span>表情を選ぶ
                </div>
                <ChipGroup
                  items={["なめらか", "ざらつき", "流れ", "斑点", "貫入", "結晶"]}
                  selected={expression}
                  onSelect={setExpression}
                />
              </div>

              <div className="field">
                <div className="field-label">
                  <span className="num-badge">3</span>透明度
                  <span className="field-hint">透明 ← → 乳濁</span>
                </div>
                <div className="slider-row">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={transparency}
                    onChange={(e) => setTransparency(Number(e.target.value))}
                  />
                  <div className="slider-val">{transparency} / 100</div>
                </div>
              </div>

              <div className="field">
                <div className="field-label">
                  <span className="num-badge">4</span>光沢度
                  <span className="field-hint">マット ← → 光沢</span>
                </div>
                <div className="slider-row">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={glossiness}
                    onChange={(e) => setGlossiness(Number(e.target.value))}
                  />
                  <div className="slider-val">{glossiness} / 100</div>
                </div>
              </div>
            </div>

            {/* Mode B: Style */}
            <div className={`mode-body ${mode === "style" ? "active" : ""}`}>
              <div className="field">
                <div className="field-label">
                  <span className="num-badge">1</span>伝統名称
                </div>
                <ChipGroup
                  items={[
                    "志野釉", "織部釉", "天目釉", "青磁釉", "黄瀬戸釉", "瀬戸黒釉",
                    "辰砂釉", "白萩釉", "海鼠釉", "鈞窯釉", "月白釉", "伊羅保釉",
                  ]}
                  selected={styleName}
                  onSelect={setStyleName}
                />
              </div>

              <div className="field">
                <div className="field-label">
                  <span className="num-badge">2</span>色や発色
                </div>
                <ChipGroup
                  items={[
                    "瑠璃釉", "トルコ青釉", "銅赤釉", "銅青磁釉", "鉄釉",
                    "柿釉", "黒釉", "鉄赤釉", "緑釉",
                  ]}
                  selected={styleColor}
                  onSelect={setStyleColor}
                />
              </div>

              <div className="field">
                <div className="field-label">
                  <span className="num-badge">3</span>仕上がりの質感
                </div>
                <ChipGroup
                  items={["透明釉", "乳濁釉", "マット釉", "貫入釉", "結晶釉", "ラスター釉"]}
                  selected={styleTexture}
                  onSelect={setStyleTexture}
                />
              </div>
            </div>

            {/* Mode C: Mood */}
            <div className={`mode-body ${mode === "mood" ? "active" : ""}`}>
              <div className="field">
                <div className="field-label">今日の気分を言葉で</div>
                <textarea
                  className="mood-input"
                  placeholder="例：雨上がりの森みたいな、静かで少し湿った感じ…"
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                />
                <div className="mood-suggest">
                  {["夕暮れの海", "古い石畳", "朝もやの山", "焚き火のそば", "月明かり"].map(
                    (m) => (
                      <div key={m} className="chip" onClick={() => setMood(m)}>
                        {m}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="nav">
              <button className="btn" onClick={() => goTo(1)}>
                ← 形を選ぶ
              </button>
              <button className="btn primary" onClick={() => goTo(3)}>
                焼き方を選ぶ →
              </button>
            </div>
          </div>

          {/* Step 3: 焼き方 */}
          <div className={`panel ${step === 3 ? "active" : ""}`}>
            <h2>焼き方を選ぶ</h2>
            <p className="sub">
              素地と焼成雰囲気を指定します。発色や質感に大きく影響します。
            </p>

            <div className="two-col">
              <div>
                <div className="field-label">素地</div>
                <div className="option-grid">
                  <div
                    className={`option-card ${clay === "陶器" ? "selected" : ""}`}
                    onClick={() => setClay("陶器")}
                  >
                    <div className="ttl">陶器</div>
                    <div className="desc">1200℃前後で焼成。素朴で温かい印象。</div>
                  </div>
                  <div
                    className={`option-card ${clay === "磁器" ? "selected" : ""}`}
                    onClick={() => setClay("磁器")}
                  >
                    <div className="ttl">磁器</div>
                    <div className="desc">1280℃以上で焼成。緻密で透光性あり。</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="field-label">焼成雰囲気</div>
                <div className="option-grid">
                  <div
                    className={`option-card ${atmosphere === "酸化焼成" ? "selected" : ""}`}
                    onClick={() => setAtmosphere("酸化焼成")}
                  >
                    <div className="ttl">酸化焼成</div>
                    <div className="desc">明るく安定した発色。再現性が高い。</div>
                  </div>
                  <div
                    className={`option-card ${atmosphere === "還元焼成" ? "selected" : ""}`}
                    onClick={() => setAtmosphere("還元焼成")}
                  >
                    <div className="ttl">還元焼成</div>
                    <div className="desc">深み・変化・渋みが出やすい。</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="nav">
              <button className="btn" onClick={() => goTo(2)}>
                ← つくり方を選ぶ
              </button>
              <button className="btn primary" onClick={() => goTo(4)}>
                調整する →
              </button>
            </div>
          </div>

          {/* Step 4: 調整 */}
          <div className={`panel ${step === 4 ? "active" : ""}`}>
            <h2>調整</h2>
            <p className="sub">焼成結果をベースに、パラメータを微調整できます。</p>

            <div className="adjust-grid">
              {(
                [
                  { label: "色の濃さ", value: tone, set: setTone, min: 0, max: 100 },
                  { label: "光沢", value: gloss, set: setGloss, min: 0, max: 100 },
                  { label: "流れの強さ", value: flow, set: setFlow, min: 0, max: 100 },
                  { label: "貫入の細かさ", value: crackle, set: setCrackle, min: 0, max: 100 },
                  { label: "焼成温度", value: temp, set: setTemp, min: 1100, max: 1300, unit: "℃" },
                  { label: "施釉の厚み", value: thickness, set: setThickness, min: 0, max: 100 },
                ] as const
              ).map((row) => (
                <div className="adjust-row" key={row.label}>
                  <div className="adjust-label">{row.label}</div>
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    value={row.value}
                    onChange={(e) => row.set(Number(e.target.value))}
                  />
                  <div className="slider-val">
                    {row.value}
                    {"unit" in row ? row.unit : ""}
                  </div>
                </div>
              ))}
            </div>

            <div className="nav">
              <button className="btn" onClick={() => goTo(3)}>
                ← 焼き方を選ぶ
              </button>
              <button className="btn primary">レシピを保存</button>
            </div>
          </div>
        </div>

        {/* Persistent Preview Sidebar */}
        <div className="app-sidebar">
          <div className="persistent-preview-card">
            <div className="preview-title">焼き上がりプレビュー</div>
            <div className="preview-visual">
              <VesselCanvas
                shape={shape}
                custom={customVessel}
                texturePath={glaze?.path ?? null}
                hex={glaze?.hex ?? null}
                gloss={gloss}
                tone={tone}
              />
            </div>
            <div className="preview-meta-info">
              <div>
                <span>器の形:</span> <span>{shapeLabel}</span>
              </div>
              <div>
                <span>釉薬ピース:</span>{" "}
                <span>{glaze ? `${glaze.id}.JPG` : "未選択"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Firing Button */}
      <button className="floating-fire-btn" onClick={() => setModalOpen(true)}>
        <span className="icon">🔥</span>焼成する
      </button>

      <FiringModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        shape={shape}
        custom={customVessel}
        glaze={glaze}
        clay={clay}
        atmosphere={atmosphere}
        temp={temp}
        thickness={thickness}
        gloss={gloss}
        tone={tone}
      />
    </div>
  );
}
