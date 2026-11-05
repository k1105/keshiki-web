"use client";

// Step-2B「釉薬から選ぶ」のモーダル。
// 左: 気になる釉薬を選ぶ。今の選択と組み合わせたデータが無いものは薄く見せて選べなくする。
// 右: 現在の素地・焼成雰囲気で、選んだ釉薬を含む実在の組み合わせを候補として並べる (未選択のときは非表示)。
// 候補を 1 つ選んで「決定」すると、その組み合わせが確定版 (glazeCombo) になる。
// 確定版は必ず実在の組み合わせになる。

import { useEffect, useMemo, useState } from "react";
import {
  availableGlazeCodes,
  findGlazeCombos,
  type GlazeCombo,
  type GlazeConditions,
  type GlazeIndex,
} from "@/lib/glaze-index";
import { GLAZE_CATEGORIES, glazeStyleByCode } from "@/lib/glaze-styles";
import type { Lang, Strings } from "@/lib/i18n";
import CloseButton from "./CloseButton";

// 一度に並べる候補の上限。多すぎるときは件数だけ添えて、釉薬を追加で選ぶよう促す
const MAX_CANDIDATES = 40;

export function glazeName(code: string, lang: Lang): string {
  const s = glazeStyleByCode(code);
  return s ? (lang === "en" ? s.en : s.ja) : code;
}

/** 組み合わせの表示名 ("長石釉、石灰釉" / "Feldspathic glaze, Lime glaze") */
export function glazeComboLabel(codes: string[], lang: Lang): string {
  return codes.map((c) => glazeName(c, lang)).join(lang === "en" ? ", " : "、");
}

const comboKey = (codes: string[]) => codes.join("+");

export default function GlazePicker({
  lang,
  t,
  index,
  conditions,
  picks,
  onTogglePick,
  onClearPicks,
  combo,
  onConfirm,
  onClose,
}: {
  lang: Lang;
  t: Strings;
  /** 釉薬索引。読み込み中は null */
  index: GlazeIndex | null;
  conditions: GlazeConditions;
  /** 気になる釉薬として選んだコード */
  picks: string[];
  onTogglePick: (code: string) => void;
  /** 気になる釉薬の選択をすべて外す */
  onClearPicks: () => void;
  /** 確定済みの組み合わせ (未確定は null) */
  combo: string[] | null;
  onConfirm: (codes: string[]) => void;
  onClose: () => void;
}) {
  // 候補のうち今ハイライトしているもの。開いた時点では確定済みの組み合わせ
  const [draft, setDraft] = useState<string[] | null>(combo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 今の選択と同じ行に載っているコード。無いものは薄く見せて選べなくする (索引が読めるまでは全部通常表示)
  const available = useMemo(
    () => (index ? availableGlazeCodes(index, conditions, picks) : null),
    [index, conditions, picks]
  );
  const candidates = useMemo(
    () => (index ? findGlazeCombos(index, conditions, picks) : []),
    [index, conditions, picks]
  );
  // 選んだ釉薬をすべて含む組み合わせがあればそれだけ、無ければ一部を含む近いものを見せる
  const exact = picks.length > 0 && candidates.some((c) => c.matched === picks.length);
  const shown: GlazeCombo[] = exact
    ? candidates.filter((c) => c.matched === picks.length)
    : candidates;
  const visible = shown.slice(0, MAX_CANDIDATES);
  const hidden = shown.length - visible.length;

  const hint = !index
    ? t.glazeLoading
    : shown.length === 0
      ? t.glazeCandidatesEmpty
      : exact
        ? null
        : t.glazeCandidatesNear;

  const draftKey = draft ? comboKey(draft) : null;
  const pickSet = new Set(picks);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glaze-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t.glazeModalTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="glaze-modal-head">
          <span>{t.glazeModalTitle}</span>
          <CloseButton label={t.glazeClose} onClick={onClose} />
        </div>

        <div className="glaze-modal-body">
          <div className="glaze-picks">
            <div className="sub-hint">{t.glazeHint}</div>
            {/* カテゴリは開閉せず、すべて開いた状態で並べる */}
            {GLAZE_CATEGORIES.map((cat) => (
              <div key={cat.key} className="glaze-cat">
                <div className="glaze-cat-h">{lang === "en" ? cat.en : cat.ja}</div>
                <div className="items is-inline">
                  {cat.styles.map((s) => {
                    const picked = pickSet.has(s.code);
                    const dim = !picked && available !== null && !available.has(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        className={`item ${picked ? "active" : ""} ${dim ? "is-dim" : ""}`}
                        disabled={dim}
                        onClick={() => onTogglePick(s.code)}
                      >
                        -{lang === "en" ? s.en : s.ja}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 釉薬を 1 つも選んでいないときは候補を出さない */}
          {picks.length > 0 && (
            <div className="glaze-cands">
              <div className="glaze-cands-title">{t.glazeCandidates}</div>
              {hint && <div className="sub-hint">{hint}</div>}
              <div className="glaze-cand-list">
                {visible.map((c) => {
                  const key = comboKey(c.codes);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`glaze-cand ${draftKey === key ? "active" : ""}`}
                      onClick={() => setDraft(c.codes)}
                      onDoubleClick={() => onConfirm(c.codes)}
                    >
                      <span
                        className={`glaze-cand-swatch ${c.hex ? "" : "is-none"}`}
                        style={c.hex ? { background: c.hex } : undefined}
                      />
                      <span className="glaze-cand-names">
                        {c.codes.map((code, i) => (
                          <span key={code}>
                            {i > 0 && (lang === "en" ? ", " : "、")}
                            <span className={pickSet.has(code) ? "is-pick" : ""}>
                              {glazeName(code, lang)}
                            </span>
                          </span>
                        ))}
                      </span>
                      <span className="glaze-cand-count">{t.glazeCount(c.count)}</span>
                    </button>
                  );
                })}
              </div>
              {hidden > 0 && <div className="sub-hint">{t.glazeMore(hidden)}</div>}
            </div>
          )}
        </div>

        <div className="glaze-modal-foot">
          {/* モーダル内の選択 (気になる釉薬・候補のハイライト) を最初の状態に戻す。確定済みの組み合わせは決定するまで変えない */}
          <button
            type="button"
            className="link"
            disabled={picks.length === 0 && !draft}
            onClick={() => {
              setDraft(null);
              onClearPicks();
            }}
          >
            {t.glazeClear}
          </button>
          <button
            type="button"
            className="link"
            disabled={!draft}
            onClick={() => draft && onConfirm(draft)}
          >
            {t.glazeConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
