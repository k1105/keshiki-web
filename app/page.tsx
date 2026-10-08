"use client";

import { useEffect, useState } from "react";
import ColorWheel from "@/components/ColorWheel";
import FiringPanel from "@/components/FiringPanel";
import HslSliderPicker from "@/components/HslSliderPicker";
import ProfileSketcher from "@/components/ProfileSketcher";
import VesselCanvas from "@/components/VesselCanvas";
import { clayByKey, type ClayKey } from "@/lib/clay";
import { findClosestColor, type GlazeColor } from "@/lib/colors";
import {
  choiceLabel,
  EXPRESSIONS,
  STRINGS,
  STYLE_COLORS,
  STYLE_NAMES,
  STYLE_TEXTURES,
  type Choice,
  type Lang,
} from "@/lib/i18n";
import type { CustomVessel, ShapeKey, VesselShape } from "@/lib/vessels";

// 素地プレビュー（素焼き）の質感。釉薬なしなのでマットに固定
const CLAY_GLOSS = 6;
const CLAY_TONE = 50;

// 焼成前のプレビューは器を小さめに置き、焼き上がりで大きく見せる
const PREVIEW_ZOOM = 0.76;
const ROTATE_SPEED = 1.6;

type CellKey =
  | "vase"
  | "haniwa"
  | "plate"
  | "handbag"
  | "teapot"
  | "flower"
  | "mug"
  | "cat"
  | "surprise";

// 形の 9 マス。shape の無いマスは 3D モデル未対応のため選択できない。
// surprise は一筆描き (Wheel) の入口
const FORM_CELLS: { key: CellKey; shape?: ShapeKey }[] = [
  { key: "vase", shape: "vase" },
  { key: "haniwa" },
  { key: "plate", shape: "plate" },
  { key: "handbag" },
  { key: "teapot", shape: "teapot" },
  { key: "flower" },
  { key: "mug", shape: "mug" },
  { key: "cat" },
  { key: "surprise" },
];

// 素地ごとのサムネイル (public/shapes/<dir>/<cell>.jpg)
const CLAY_ORDER: { key: ClayKey; dir: string }[] = [
  { key: "stoneware-white", dir: "white" },
  { key: "stoneware-red", dir: "red" },
  { key: "porcelain", dir: "porcelain" },
];

type Mode = "visual" | "style" | "mood";
type ColorMode = "wheel" | "slider";
type View = "title" | "main";
type FormView = "grid" | "draw" | "preview";
type GlazeView = "main" | "surface";

// ロゴはデザインのピクセル字形をそのままトレースしたもの（フォントに依存させない）
const LOGO_ROWS = [
  ".###..#....##...###..###",
  "#.....#...#..#...#.....#",
  "#.....#...#..#...#....#.",
  "#.##..#...####...#....#.",
  "#..#..#...#..#...#...#..",
  ".###..###.#..#..###..###",
];
const LOGO_PATH = LOGO_ROWS.flatMap((row, y) =>
  [...row].map((ch, x) => (ch === "#" ? `M${x} ${y}h1v1h-1z` : ""))
).join("");

function Logo() {
  return (
    <svg
      className="logo-mark"
      viewBox={`0 0 ${LOGO_ROWS[0].length} ${LOGO_ROWS.length}`}
      role="img"
      aria-label="GLAIZ"
    >
      <path d={LOGO_PATH} />
    </svg>
  );
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg className={`arrow is-${dir}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 4h6v2H0zM4 0h2v2H4zM6 2h2v2H6zM8 4h2v2H8zM6 6h2v2H6zM4 8h2v2H4z" />
    </svg>
  );
}

function RotateIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg className={`rotate-icon is-${dir}`} viewBox="0 0 40 30" aria-hidden="true">
      <path d="M33 9C21 5 4 8 4 16c0 7 17 10 32 6" />
      <path d="M25 3l9 6-10 4" />
    </svg>
  );
}

function ChoiceList({
  items,
  selected,
  onSelect,
  lang,
  className = "items",
}: {
  items: Choice[];
  selected: string;
  onSelect: (v: string) => void;
  lang: Lang;
  className?: string;
}) {
  return (
    <div className={className}>
      {items.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`item ${selected === c.value ? "active" : ""}`}
          onClick={() => onSelect(c.value)}
        >
          -{choiceLabel(c, lang)}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const t = STRINGS[lang];
  const [view, setView] = useState<View>("title");
  const [about, setAbout] = useState(false);

  const [step, setStep] = useState(1);
  const [formView, setFormView] = useState<FormView>("grid");
  const [glazeView, setGlazeView] = useState<GlazeView>("main");

  const [shape, setShape] = useState<VesselShape>("vase");
  const [selectedCell, setSelectedCell] = useState<CellKey>("vase");
  const [customVessel, setCustomVessel] = useState<CustomVessel | null>(null);
  const [glaze, setGlaze] = useState<GlazeColor | null>(() =>
    findClosestColor("#2f6d5f")
  );
  // HSLスライダー編集中の「指定した色」。編集中はプレビューをディゾルブなしでその場更新する
  const [livePreviewHex, setLivePreviewHex] = useState<string | null>(null);
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

  const [clayKey, setClayKey] = useState<ClayKey>("stoneware-white");
  const clay = clayByKey(clayKey);
  const clayDir =
    CLAY_ORDER.find((c) => c.key === clayKey)?.dir ?? CLAY_ORDER[0].dir;
  const [atmosphere, setAtmosphere] = useState("還元焼成");

  const [tone, setTone] = useState(60);
  const [gloss, setGloss] = useState(70);
  const [flow, setFlow] = useState(30);
  const [crackle, setCrackle] = useState(50);
  const [temp, setTemp] = useState(1230);
  const [thickness, setThickness] = useState(55);

  // 焼成: FIRE を押すたびに fireKey を進めて Step 3 で生成を走らせる
  const [fireKey, setFireKey] = useState(0);
  const [firedTexture, setFiredTexture] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  const [rotateDir, setRotateDir] = useState(1);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const pickCell = (cell: (typeof FORM_CELLS)[number]) => {
    if (cell.key === "surprise") {
      setFormView("draw");
      return;
    }
    if (!cell.shape) return;
    setSelectedCell(cell.key);
    setShape(cell.shape);
  };

  const pickCustomShape = (v: CustomVessel) => {
    setCustomVessel(v);
    setShape("custom");
    setSelectedCell("surprise");
    setFormView("preview");
  };

  const startFiring = () => {
    setFiredTexture(null);
    setFiring(true);
    setFireKey((k) => k + 1);
    setStep(3);
  };

  const backToGlaze = () => {
    setGlazeView("main");
    setStep(2);
  };

  // Step 1 では釉薬をかける前の素地を表示し、Step 2 では選択中の釉薬の単色（DB 上の色）を
  // 即座に器に載せる。テストピース画像はテクスチャとして使わない。
  // 焼成後 (Step 3 以降) は生成テクスチャを載せる
  const showingClay = step === 1;
  const preview = showingClay
    ? {
        texturePath: null,
        hex: clay.hex,
        dissolveKey: `clay:${clay.key}`,
        gloss: CLAY_GLOSS,
        tone: CLAY_TONE,
      }
    : {
        texturePath: step >= 3 ? firedTexture : null,
        hex: glaze?.hex ?? null,
        dissolveKey:
          livePreviewHex !== null ? "live" : `glaze:${glaze?.id ?? "none"}`,
        gloss,
        tone,
      };

  const inFlow = view === "main" && !about;
  const firingNow = step === 3 && firing;
  const showResult = step === 3 && !firing;
  // 器の 3D プレビューを出す画面。形の一覧・一筆描き中は出さない
  const showViewer = inFlow && (step >= 2 || formView === "preview");

  const adjustRows = [
    { key: "tone", value: tone, set: setTone, min: 0, max: 100, unit: "" },
    { key: "gloss", value: gloss, set: setGloss, min: 0, max: 100, unit: "" },
    { key: "flow", value: flow, set: setFlow, min: 0, max: 100, unit: "" },
    { key: "crackle", value: crackle, set: setCrackle, min: 0, max: 100, unit: "" },
    { key: "temp", value: temp, set: setTemp, min: 1100, max: 1300, unit: "℃" },
    { key: "thickness", value: thickness, set: setThickness, min: 0, max: 100, unit: "" },
  ] as const;

  const backdropState =
    view === "title" ? "is-title" : inFlow && firingNow ? "is-firing" : "";

  return (
    <>
      <div className={`backdrop ${backdropState}`} aria-hidden="true">
        <div className="backdrop-title" />
        <div className="backdrop-firing" />
        <div className="backdrop-grid" />
        <div className="backdrop-grain" />
      </div>

      <div className={`stage ${inFlow && firingNow ? "is-firing" : ""}`}>
        {/* 共通クローム: ロゴと右ナビ。焼成演出中は隠す */}
        {!(inFlow && firingNow) && (
          <button
            type="button"
            className="logo"
            onClick={() => {
              setAbout(false);
              setView("title");
            }}
          >
            <Logo />
          </button>
        )}

        {view === "main" && !firingNow && (
          <nav className="rnav">
            <button
              type="button"
              className={`rnav-item is-about ${about ? "active" : ""}`}
              onClick={() => setAbout((a) => !a)}
            >
              {t.about}
            </button>
            <div className="rnav-item is-lang">
              <button
                type="button"
                className={lang === "en" ? "active" : ""}
                onClick={() => setLang("en")}
              >
                EN
              </button>
              <span> / </span>
              <button
                type="button"
                className={lang === "ja" ? "active" : ""}
                onClick={() => setLang("ja")}
              >
                JP
              </button>
            </div>
            {/* ARCHIVE / SHARE は未実装のため非活性 */}
            <span className="rnav-item is-archive is-disabled" aria-disabled="true">
              {t.archive}
            </span>
            <span className="rnav-item is-share is-disabled" aria-disabled="true">
              {t.share}
            </span>
          </nav>
        )}

        {view === "title" && (
          <button
            type="button"
            className="title-screen"
            aria-label={t.start}
            onClick={() => setView("main")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="title-vessel" src="/title-vessel.webp" alt="" />
          </button>
        )}

        {view === "main" && about && (
          <div className="about">
            <h1>
              {t.aboutHeading.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
            {t.aboutBody.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}

        {/* 制作フロー。ABOUT / タイトル表示中も状態を保つため、隠すだけでアンマウントしない */}
        <div className="flow" hidden={!inFlow}>
          {/* Step 1: 形・素地・焼成雰囲気 */}
          {step === 1 && (
            <>
              <div className="col">
                <div className="group">
                  <button
                    type="button"
                    className="h"
                    onClick={() => setFormView("grid")}
                  >
                    +{t.form}
                  </button>
                </div>
                <div className="group">
                  <div className="h">+{t.clayBody}</div>
                  <div className="items">
                    {CLAY_ORDER.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={`item ${clayKey === c.key ? "active" : ""}`}
                        onClick={() => setClayKey(c.key)}
                      >
                        -{t.clays[c.key]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="group">
                  <div className="h">+{t.atmosphere}</div>
                  <div className="items">
                    <button
                      type="button"
                      className={`item ${atmosphere === "酸化焼成" ? "active" : ""}`}
                      onClick={() => setAtmosphere("酸化焼成")}
                    >
                      -{t.oxidation}
                    </button>
                    <button
                      type="button"
                      className={`item ${atmosphere === "還元焼成" ? "active" : ""}`}
                      onClick={() => setAtmosphere("還元焼成")}
                    >
                      -{t.reduction}
                    </button>
                  </div>
                </div>
              </div>

              {formView === "grid" && (
                <div className="panel shape-grid">
                  {FORM_CELLS.map((cell) => {
                    const selectable = cell.key === "surprise" || !!cell.shape;
                    const selected = selectedCell === cell.key;
                    const label =
                      cell.key === "surprise" && selected
                        ? t.shapes.wheel
                        : t.shapes[cell.key];
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        className={`shape-cell ${selected ? "selected" : ""}`}
                        disabled={!selectable}
                        onClick={() => pickCell(cell)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/shapes/${clayDir}/${cell.key}.jpg`} alt="" />
                        <span className="shape-label">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {formView === "draw" && (
                <div className="panel finegrid">
                  <ProfileSketcher
                    onShapeDrawn={pickCustomShape}
                    hint={t.drawHint}
                    tooShortText={t.drawTooShort}
                  />
                </div>
              )}

              <div className="nav">
                <button
                  type="button"
                  className="link"
                  disabled={formView === "draw"}
                  onClick={() => setStep(2)}
                >
                  {t.next} <Arrow dir="right" />
                </button>
              </div>
            </>
          )}

          {/* Step 2: 釉薬のつくり方。左カラムの見出しで 3 方式を切り替える */}
          {step === 2 && glazeView === "main" && (
            <>
              <div className="col is-accordion">
                <div className="group">
                  <button
                    type="button"
                    className="h"
                    onClick={() => setMode("visual")}
                  >
                    +{t.color}
                  </button>
                  {mode === "visual" && (
                    <>
                      <div className="subtabs">
                        <button
                          type="button"
                          className={colorMode === "wheel" ? "active" : ""}
                          onClick={() => setColorMode("wheel")}
                        >
                          -{t.colorWheel}
                        </button>
                        <span> / </span>
                        <button
                          type="button"
                          className={colorMode === "slider" ? "active" : ""}
                          onClick={() => setColorMode("slider")}
                        >
                          {t.hslSliders}
                        </button>
                      </div>
                      {colorMode === "wheel" ? (
                        <ColorWheel
                          selected={glaze}
                          onSelect={setGlaze}
                          labels={t.wheelFilters}
                        />
                      ) : (
                        <HslSliderPicker
                          selected={glaze}
                          onSelect={setGlaze}
                          onPreviewColor={setLivePreviewHex}
                          labels={t}
                        />
                      )}
                    </>
                  )}
                </div>

                <div className="group">
                  <button
                    type="button"
                    className="h"
                    onClick={() => setMode("style")}
                  >
                    +{t.glazeStyle}
                  </button>
                  {mode === "style" && (
                    <div className="style-groups">
                      <div className="style-label">{t.styleName}</div>
                      <ChoiceList
                        className="items is-inline"
                        items={STYLE_NAMES}
                        selected={styleName}
                        onSelect={setStyleName}
                        lang={lang}
                      />
                      <div className="style-label">{t.styleColor}</div>
                      <ChoiceList
                        className="items is-inline"
                        items={STYLE_COLORS}
                        selected={styleColor}
                        onSelect={setStyleColor}
                        lang={lang}
                      />
                      <div className="style-label">{t.styleTexture}</div>
                      <ChoiceList
                        className="items is-inline"
                        items={STYLE_TEXTURES}
                        selected={styleTexture}
                        onSelect={setStyleTexture}
                        lang={lang}
                      />
                    </div>
                  )}
                </div>

                <div className="group">
                  <button
                    type="button"
                    className="h"
                    onClick={() => setMode("mood")}
                  >
                    +{t.withWords}
                  </button>
                  {mode === "mood" && (
                    <textarea
                      className="words"
                      placeholder={t.moodPlaceholder}
                      value={mood}
                      onChange={(e) => setMood(e.target.value)}
                    />
                  )}
                </div>
              </div>

              <div className="nav">
                <button type="button" className="link" onClick={() => setStep(1)}>
                  <Arrow dir="left" /> {t.back}
                </button>
                <span className="sep">/</span>
                {mode === "visual" ? (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setGlazeView("surface")}
                  >
                    {t.next} <Arrow dir="right" />
                  </button>
                ) : (
                  <button type="button" className="link" onClick={startFiring}>
                    {t.fire} <Arrow dir="right" />
                  </button>
                )}
              </div>
            </>
          )}

          {/* Step 2 (見た目からつくる) の 2 画面目: 表情・透明度・光沢 */}
          {step === 2 && glazeView === "surface" && (
            <>
              <div className="col">
                <div className="group">
                  <div className="h">+{t.surfaceEffect}</div>
                  <ChoiceList
                    items={EXPRESSIONS}
                    selected={expression}
                    onSelect={setExpression}
                    lang={lang}
                  />
                </div>
                <div className="group">
                  <div className="h">+{t.transparency}</div>
                  <input
                    type="range"
                    className="slider"
                    min={0}
                    max={100}
                    value={transparency}
                    aria-label={t.transparency}
                    onChange={(e) => setTransparency(Number(e.target.value))}
                  />
                </div>
                <div className="group">
                  <div className="h">+{t.gloss}</div>
                  <input
                    type="range"
                    className="slider"
                    min={0}
                    max={100}
                    value={glossiness}
                    aria-label={t.gloss}
                    onChange={(e) => setGlossiness(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="nav">
                <button
                  type="button"
                  className="link"
                  onClick={() => setGlazeView("main")}
                >
                  <Arrow dir="left" /> {t.back}
                </button>
                <span className="sep">/</span>
                <button type="button" className="link" onClick={startFiring}>
                  {t.fire} <Arrow dir="right" />
                </button>
              </div>
            </>
          )}

          {/* Step 3: 焼成。進行中は焼成演出、焼き上がるとレシピを表示する */}
          <FiringPanel
            active={step === 3}
            fireKey={fireKey}
            ui={{
              mode,
              glaze,
              expression,
              transparency,
              glossiness,
              styleName,
              styleColor,
              styleTexture,
              mood,
              clay: clay.name,
              atmosphere,
              temp,
            }}
            thickness={thickness}
            t={t}
            onTexture={setFiredTexture}
            onGeneratingChange={setFiring}
          />

          {step === 3 && (
            <div className="nav">
              <button type="button" className="link" onClick={backToGlaze}>
                <Arrow dir="left" /> {t.back}
              </button>
              {showResult && (
                <>
                  <span className="sep">/</span>
                  <button type="button" className="link" onClick={() => setStep(4)}>
                    {t.adjust}
                  </button>
                </>
              )}
            </div>
          )}

          {showResult && (
            <>
              <button
                type="button"
                className="rotate is-left"
                aria-label={t.rotateLeft}
                onClick={() => setRotateDir(-1)}
              >
                <RotateIcon dir="left" />
              </button>
              <button
                type="button"
                className="rotate is-right"
                aria-label={t.rotateRight}
                onClick={() => setRotateDir(1)}
              >
                <RotateIcon dir="right" />
              </button>
            </>
          )}

          {/* Step 4: 調整 */}
          {step === 4 && (
            <>
              <div className="col">
                <div className="group">
                  <div className="h">+{t.adjust}</div>
                  <div className="adjust-rows">
                    {adjustRows.map((row) => (
                      <label className="adjust-row" key={row.key}>
                        <span className="adjust-label">
                          <span>-{t.adjustRows[row.key]}</span>
                          <span>
                            {row.value}
                            {row.unit}
                          </span>
                        </span>
                        <input
                          type="range"
                          className="slider"
                          min={row.min}
                          max={row.max}
                          value={row.value}
                          onChange={(e) => row.set(Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="nav">
                <button type="button" className="link" onClick={() => setStep(3)}>
                  <Arrow dir="left" /> {t.back}
                </button>
              </div>
            </>
          )}

          {showViewer && (
            <div
              className={`panel viewer ${firingNow ? "is-firing" : "finegrid"}`}
            >
              <VesselCanvas
                shape={shape}
                custom={customVessel}
                texturePath={preview.texturePath}
                hex={preview.hex}
                dissolveKey={preview.dissolveKey}
                gloss={preview.gloss}
                tone={preview.tone}
                zoom={step >= 3 ? 1 : PREVIEW_ZOOM}
                lowPoly={step < 3}
                autoRotateSpeed={ROTATE_SPEED * rotateDir}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
