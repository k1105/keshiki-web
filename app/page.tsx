"use client";

import { useEffect, useMemo, useState } from "react";
import CaptureDebugger from "@/components/CaptureDebugger";
import ColorWheel from "@/components/ColorWheel";
import FiringPanel from "@/components/FiringPanel";
import type { FiringProgress } from "@/lib/firing-run";
import GlazePicker, { glazeComboLabel } from "@/components/GlazePicker";
import HslSliderPicker from "@/components/HslSliderPicker";
import ProfileSketcher from "@/components/ProfileSketcher";
import VesselCanvas from "@/components/VesselCanvas";
import { clayByKey, type ClayKey } from "@/lib/clay";
import { findClosestColor, type GlazeColor } from "@/lib/colors";
import { defaultCaptureAngle, type CaptureAngle } from "@/lib/depth";
import { baseConditionsOf, type Hyomen, type YuseijoA, type YuseijoB } from "@/lib/generate_v5";
import { loadGlazeIndex, representativeGlazeColor, type GlazeIndex } from "@/lib/glaze-index";
import { STRINGS, type Lang } from "@/lib/i18n";
import {
  MODEL_SHAPES,
  type CustomVessel,
  type ModelShapeKey,
  type ShapeKey,
  type VesselShape,
} from "@/lib/vessels";

// 素地プレビュー（素焼き）の質感。釉薬なしなのでマットに固定
const CLAY_GLOSS = 6;
const CLAY_TONE = 50;
// 釉薬プレビューの色の濃さと、表面状態ごとの光沢
const GLAZE_TONE = 60;
const GLAZE_GLOSS: Record<Hyomen, number> = {
  HyomenKotaku: 85,
  HyomenHanKotaku: 50,
  HyomenTsuyakeshi: 12,
};
const DEFAULT_GLOSS = 70;

// 焼成前のプレビューは器を小さめに置き、焼き上がりで大きく見せる
const PREVIEW_ZOOM = 0.76;
const ROTATE_SPEED = 1.6;

// 焼成温度の既定 (レシピは DB から選ばれるので、API に送る以外では使わない)
const DEFAULT_TEMP = 1230;

const HYOMEN_OPTIONS: Hyomen[] = ["HyomenKotaku", "HyomenHanKotaku", "HyomenTsuyakeshi"];
const YUSEIJO_A_OPTIONS: YuseijoA[] = [
  "YuseijoAMushokuTomei",
  "YuseijoAYusyokuTomei",
  "YuseijoAMFutoumei",
];
const YUSEIJO_B_OPTIONS: YuseijoB[] = [
  "YuseijoBKinitsu",
  "YuseijoBFukinnitsu",
  "YuseijoBKessho",
  "YuseijoBKannyu",
  "YuseijoBLuster",
];

type CellKey =
  "vase" | "haniwa" | "plate" | "handbag" | "teapot" | "flower" | "mug" | "cat" | "surprise";

// 形の 9 マス。shape の無いマスは 3D モデル未対応のため選択できない。
// 埴輪・バッグ・花・猫は Tripo で生成した GLB (lib/vessels.ts MODEL_SHAPES)。GLB が無い間は選べない。
// surprise は一筆描き (Wheel) の入口
const modelCell = (key: ModelShapeKey) => ({
  key,
  shape: MODEL_SHAPES[key].ready ? key : undefined,
});
const FORM_CELLS: { key: CellKey; shape?: ShapeKey | ModelShapeKey }[] = [
  { key: "vase", shape: "vase" },
  modelCell("haniwa"),
  { key: "plate", shape: "plate" },
  modelCell("handbag"),
  { key: "teapot", shape: "teapot" },
  modelCell("flower"),
  { key: "mug", shape: "mug" },
  modelCell("cat"),
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
type AppearanceSub = "color" | "surface" | "transparency" | "character";

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

/** 一筆描きのモーダル。Esc と背景クリックで閉じる */
function SketchModal({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="sketch-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glaze-modal-head">
          <span>{title}</span>
          <button type="button" className="link" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className="sketch-modal-body finegrid">{children}</div>
      </div>
    </div>
  );
}

/** 横並びの選択肢 (単一選択) */
function InlineChoices<T extends string>({
  options,
  selected,
  label,
  onSelect,
}: {
  options: T[];
  selected: T;
  label: (v: T) => string;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="items is-inline">
      {options.map((v) => (
        <button
          key={v}
          type="button"
          className={`item ${selected === v ? "active" : ""}`}
          onClick={() => onSelect(v)}
        >
          -{label(v)}
        </button>
      ))}
    </div>
  );
}

/** 見出しをクリックすると中身が開く小見出し。閉じているときは現在の値を添える */
function SubHead({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`sub ${open ? "is-open" : ""}`}>
      <button type="button" className="sub-h" onClick={onToggle}>
        <span>{label}</span>
        {!open && value != null && <span className="sub-val">{value}</span>}
      </button>
      {open && <div className="sub-body">{children}</div>}
    </div>
  );
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("ja");
  const t = STRINGS[lang];
  const [view, setView] = useState<View>("title");
  const [about, setAbout] = useState(false);

  const [step, setStep] = useState(1);

  // Step 1: 見出しは開閉しない (常に全部開いている)。かたちは中央のパネルに出し、一筆描きはモーダルで描く
  const [sketchOpen, setSketchOpen] = useState(false);

  const [shape, setShape] = useState<VesselShape>("vase");
  const [selectedCell, setSelectedCell] = useState<CellKey>("vase");
  const [customVessel, setCustomVessel] = useState<CustomVessel | null>(null);
  const [glaze, setGlaze] = useState<GlazeColor | null>(() => findClosestColor("#2f6d5f"));
  // HSLスライダー編集中の「指定した色」。編集中はプレビューをディゾルブなしでその場更新する
  const [livePreviewHex, setLivePreviewHex] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("wheel");

  // Step 2: 3 方式のどれを開いているか。開くまでは見出しだけが並ぶ
  const [mode, setMode] = useState<Mode | null>(null);
  const [appearanceSub, setAppearanceSub] = useState<AppearanceSub>("color");
  const [hyomen, setHyomen] = useState<Hyomen>("HyomenKotaku");
  const [yuseijoA, setYuseijoA] = useState<YuseijoA>("YuseijoAYusyokuTomei");
  const [yuseijoB, setYuseijoB] = useState<YuseijoB>("YuseijoBKinitsu");
  // 釉薬から選ぶ: 気になる釉薬 (glazePicks) はモーダルで自由に選び、
  // それを含む実在の組み合わせの候補から 1 つ確定したものが glazeCombo。
  // 焼成に使うのは常に glazeCombo (= データベースに実在する組み合わせ)
  const [glazePicks, setGlazePicks] = useState<string[]>([]);
  const [glazeCombo, setGlazeCombo] = useState<string[] | null>(null);
  const [glazeModal, setGlazeModal] = useState(false);
  const [glazeIndex, setGlazeIndex] = useState<GlazeIndex | null>(null);
  const [mood, setMood] = useState(
    "きょうは雨上がりの森みたいな、静かで少し湿った感じな気分です。"
  );

  const [clayKey, setClayKey] = useState<ClayKey>("stoneware-white");
  const clay = clayByKey(clayKey);
  const clayDir = CLAY_ORDER.find((c) => c.key === clayKey)?.dir ?? CLAY_ORDER[0].dir;
  const [atmosphere, setAtmosphere] = useState("酸化焼成");

  // 焼成: FIRE を押すたびに fireKey を進めて Step 3 で生成を走らせる
  const [fireKey, setFireKey] = useState(0);
  // 焼成の進捗 (温度・途中の絵・粒・GLB)。焼き上がった器は progress.glb を VesselCanvas で表示する
  const [firingProgress, setFiringProgress] = useState<FiringProgress | null>(null);
  const [firing, setFiring] = useState(false);
  const [rotateDir, setRotateDir] = useState(1);

  // 深度画像を撮る角度。既定は形ごと (lib/depth.ts defaultCaptureAngle)。
  // ?debug=capture で開くデバッガーで変えた値 (null でなければ) がそれを上書きする
  const [captureOverride, setCaptureOverride] = useState<CaptureAngle | null>(null);
  const captureAngle = captureOverride ?? defaultCaptureAngle(shape);
  const [captureDebug, setCaptureDebug] = useState(false);
  useEffect(() => {
    setCaptureDebug(new URLSearchParams(window.location.search).get("debug") === "capture");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // 釉薬から選ぶを開いたら索引を読み、実在する組み合わせを候補に出せるようにする
  useEffect(() => {
    if (mode !== "style" || glazeIndex) return;
    let cancelled = false;
    loadGlazeIndex()
      .then((idx) => {
        if (!cancelled) setGlazeIndex(idx);
      })
      .catch((e) => console.error("glaze index load failed", e));
    return () => {
      cancelled = true;
    };
  }, [mode, glazeIndex]);

  const baseConditions = useMemo(
    () => baseConditionsOf({ clay: clay.name, atmosphere }),
    [clay.name, atmosphere]
  );
  // 釉薬から選んでいるとき、確定した組み合わせの実データの代表色 (DB のマンセル値由来)。
  // 無ければ色相環で選んだ色のまま
  const styleHex = useMemo(
    () =>
      glazeIndex && glazeCombo
        ? representativeGlazeColor(glazeIndex, baseConditions, glazeCombo)
        : null,
    [glazeIndex, baseConditions, glazeCombo]
  );

  const pickCell = (cell: (typeof FORM_CELLS)[number]) => {
    if (cell.key === "surprise") {
      setSketchOpen(true);
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
    setSketchOpen(false);
  };

  const toggleGlazePick = (code: string) => {
    setGlazePicks((codes) =>
      codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]
    );
  };

  const openGlazeModal = () => {
    setMode("style");
    setGlazeModal(true);
  };

  const confirmGlazeCombo = (codes: string[]) => {
    setGlazeCombo(codes);
    setGlazeModal(false);
  };

  const startFiring = () => {
    setFiringProgress(null);
    setFiring(true);
    setFireKey((k) => k + 1);
    setStep(3);
  };

  const canFire =
    mode === "visual" ||
    (mode === "style" && glazeCombo !== null) ||
    (mode === "mood" && mood.trim().length > 0);

  // Step 1 では釉薬をかける前の素地を表示し、Step 2 では選択中の釉薬の単色（DB 上の色）を
  // 即座に器に載せる。テストピース画像はテクスチャとして使わない。
  // 焼成後 (Step 3 以降) は手続き生成の器の代わりに焼き上がった GLB を表示する
  const showingClay = step === 1;
  const preview = showingClay
    ? {
        texturePath: null,
        hex: clay.hex,
        dissolveKey: `clay:${clay.key}`,
        gloss: CLAY_GLOSS,
        tone: CLAY_TONE,
      }
    : mode === "style" && styleHex
      ? {
          texturePath: null,
          hex: styleHex,
          dissolveKey: `style:${styleHex}`,
          gloss: DEFAULT_GLOSS,
          tone: GLAZE_TONE,
        }
      : {
          texturePath: null,
          hex: glaze?.hex ?? null,
          dissolveKey: livePreviewHex !== null ? "live" : `glaze:${glaze?.id ?? "none"}`,
          gloss: mode === "visual" ? GLAZE_GLOSS[hyomen] : DEFAULT_GLOSS,
          tone: GLAZE_TONE,
        };

  const inFlow = view === "main" && !about;
  const firingNow = step === 3 && firing;
  const showResult = step === 3 && !firing;
  // 焼き上がった器の GLB (焼成中・未生成は null)
  const firedGlb = step >= 3 && !firing ? (firingProgress?.glb ?? null) : null;
  // 焼成中に届く途中経過の粒。届くまではローポリのまま (焼成開始で急にリッチにしない)
  const firingPoints = firingNow ? (firingProgress?.points ?? null) : null;
  // 焼成中に届く生成途中の絵 (または焼き上がりの絵)。粒が届いたら粒を優先する
  const firingFrame =
    firingNow && firingPoints === null
      ? (firingProgress?.preview?.image ?? firingProgress?.image ?? null)
      : null;
  const inKiln = firingNow && firingPoints === null;
  const lowPoly = step < 3 || inKiln;
  // 器の 3D プレビューを出す画面。Step 1 は中央にかたちの一覧 (または一筆描き) を出すので出さない
  const showViewer = inFlow && step >= 2;

  const backdropState = view === "title" ? "is-title" : inFlow && firingNow ? "is-firing" : "";

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
          {/* Step 1: 形・素地・焼成雰囲気。見出しと中身は常に全部出す (開閉なし) */}
          {step === 1 && (
            <>
              <div className="col">
                <div className="section-title">{t.selectBase}</div>
                <div className="group">
                  <div className="h">{t.clayBody}</div>
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
                  <div className="h">{t.atmosphere}</div>
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

              <div className="panel shape-grid">
                  {FORM_CELLS.map((cell) => {
                    const selectable = cell.key === "surprise" || !!cell.shape;
                    const selected = selectedCell === cell.key;
                    const cellLabel =
                      cell.key === "surprise" && selected ? t.shapes.wheel : t.shapes[cell.key];
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
                        <span className="shape-label">{cellLabel}</span>
                      </button>
                    );
                  })}
              </div>

              {/* 一筆描き: モーダルで描き、描き終わると閉じて custom の形になる */}
              {sketchOpen && (
                <SketchModal
                  title={t.shapes.wheel}
                  closeLabel={t.glazeClose}
                  onClose={() => setSketchOpen(false)}
                >
                  <ProfileSketcher
                    onShapeDrawn={pickCustomShape}
                    hint={t.drawHint}
                    tooShortText={t.drawTooShort}
                  />
                </SketchModal>
              )}

              <div className="nav">
                <button type="button" className="link" onClick={() => setStep(2)}>
                  {t.next} <Arrow dir="right" />
                </button>
              </div>
            </>
          )}

          {/* Step 2: 釉薬のつくり方。見出しだけが並び、クリックした方式が開く (他はグレーアウト) */}
          {step === 2 && (
            <>
              <div className="col is-accordion">
                <div className="section-title">{t.selectLook}</div>

                <div className="group">
                  <button
                    type="button"
                    className={`h ${mode === "visual" ? "active" : mode ? "is-dim" : ""}`}
                    onClick={() => setMode("visual")}
                  >
                    {t.appearance}
                  </button>
                  {mode === "visual" && (
                    <div className="subs">
                      <SubHead
                        label={t.color}
                        value={
                          glaze && (
                            <span
                              className="sub-swatch"
                              style={{
                                background: livePreviewHex ?? glaze.hex,
                              }}
                            />
                          )
                        }
                        open={appearanceSub === "color"}
                        onToggle={() => setAppearanceSub("color")}
                      >
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
                      </SubHead>

                      <SubHead
                        label={t.surface}
                        value={t.hyomen[hyomen]}
                        open={appearanceSub === "surface"}
                        onToggle={() => setAppearanceSub("surface")}
                      >
                        <InlineChoices
                          options={HYOMEN_OPTIONS}
                          selected={hyomen}
                          label={(v) => t.hyomen[v]}
                          onSelect={setHyomen}
                        />
                      </SubHead>

                      <SubHead
                        label={t.transparency}
                        value={t.yuseijoA[yuseijoA]}
                        open={appearanceSub === "transparency"}
                        onToggle={() => setAppearanceSub("transparency")}
                      >
                        <InlineChoices
                          options={YUSEIJO_A_OPTIONS}
                          selected={yuseijoA}
                          label={(v) => t.yuseijoA[v]}
                          onSelect={setYuseijoA}
                        />
                      </SubHead>

                      <SubHead
                        label={t.character}
                        value={t.yuseijoB[yuseijoB]}
                        open={appearanceSub === "character"}
                        onToggle={() => setAppearanceSub("character")}
                      >
                        <InlineChoices
                          options={YUSEIJO_B_OPTIONS}
                          selected={yuseijoB}
                          label={(v) => t.yuseijoB[v]}
                          onSelect={setYuseijoB}
                        />
                      </SubHead>
                    </div>
                  )}
                </div>

                <div className="group">
                  <button
                    type="button"
                    className={`h ${mode === "style" ? "active" : mode ? "is-dim" : ""}`}
                    onClick={openGlazeModal}
                  >
                    {t.glazeHeading}
                  </button>
                  {mode === "style" && (
                    <div className="subs">
                      {glazeCombo ? (
                        <div className="glaze-combo">
                          {styleHex && (
                            <span className="glaze-combo-swatch" style={{ background: styleHex }} />
                          )}
                          {glazeComboLabel(glazeCombo, lang)}
                        </div>
                      ) : (
                        <div className="glaze-combo is-none">{t.glazeNone}</div>
                      )}
                      <button type="button" className="glaze-change" onClick={openGlazeModal}>
                        -{glazeCombo ? t.glazeChange : t.glazeOpen}
                      </button>
                    </div>
                  )}
                </div>

                <div className="group">
                  <button
                    type="button"
                    className={`h ${mode === "mood" ? "active" : mode ? "is-dim" : ""}`}
                    onClick={() => setMode("mood")}
                  >
                    {t.inspiration}
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
                <button type="button" className="link" disabled={!canFire} onClick={startFiring}>
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
              mode: mode ?? "visual",
              glaze,
              hyomen,
              yuseijoA,
              yuseijoB,
              glazeCodes: glazeCombo ?? [],
              mood,
              clay: clay.name,
              atmosphere,
              temp: DEFAULT_TEMP,
            }}
            shape={shape}
            custom={customVessel}
            captureAngle={captureAngle}
            t={t}
            onGeneratingChange={setFiring}
            onProgress={setFiringProgress}
          />

          {step === 3 && (
            <div className="nav">
              <button type="button" className="link" onClick={() => setStep(2)}>
                <Arrow dir="left" /> {t.back}
              </button>
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

          {step === 2 && glazeModal && (
            <GlazePicker
              lang={lang}
              t={t}
              index={glazeIndex}
              conditions={baseConditions}
              picks={glazePicks}
              onTogglePick={toggleGlazePick}
              combo={glazeCombo}
              onConfirm={confirmGlazeCombo}
              onClose={() => setGlazeModal(false)}
            />
          )}

          {showViewer && (
            <div
              className={`panel viewer ${inKiln ? "is-firing" : firingNow ? "" : "finegrid"} ${
                firingFrame ? "is-hidden" : ""
              }`}
            >
              <VesselCanvas
                shape={shape}
                custom={customVessel}
                texturePath={preview.texturePath}
                hex={preview.hex}
                dissolveKey={preview.dissolveKey}
                gloss={preview.gloss}
                tone={preview.tone}
                zoom={lowPoly ? PREVIEW_ZOOM : 1}
                lowPoly={lowPoly}
                glb={firedGlb}
                points={firingPoints}
                autoRotateSpeed={ROTATE_SPEED * rotateDir}
              />
            </div>
          )}
        </div>
      </div>

      {captureDebug && (
        <CaptureDebugger
          shape={shape}
          custom={customVessel}
          angle={captureAngle}
          onChange={setCaptureOverride}
          onClose={() => setCaptureDebug(false)}
        />
      )}
    </>
  );
}
