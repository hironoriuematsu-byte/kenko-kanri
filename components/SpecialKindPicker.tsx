"use client";

import { SPECIAL_KINDS, parseKinds } from "@/lib/checkups";

// 特殊健診の種類を、一覧から選ぶ(書き方のゆれで区分が分かれないようにする)。
//   multiple: 送る画面。いくつ選んでもよく、選ばなければ「おまかせ」(ファイルの中身から見分ける)
//   それ以外: 手作業の取込・個別入力。1つだけ選ぶ
// 値は、選んだ種類を「,」でつないだ文字列(「その他」に名前を書いたときは、その名前)
const LISTED: readonly string[] = SPECIAL_KINDS.filter((k) => k !== "その他");
const OTHER = "その他";
const clean = (s: string) => s.replace(/[,、，]/g, " ").trim();

export default function SpecialKindPicker({
  value,
  onChange,
  multiple = false,
}: {
  value: string;
  onChange: (v: string) => void;
  multiple?: boolean;
}) {
  const all = parseKinds(value);
  const listed = all.filter((k) => LISTED.includes(k));
  const others = all.filter((k) => !LISTED.includes(k));
  const otherOn = others.length > 0;
  const otherName = others.find((k) => k !== OTHER) ?? "";
  const build = (kinds: string[], other: boolean, name: string) =>
    [...LISTED.filter((k) => kinds.includes(k)), ...(other ? [clean(name) || OTHER] : [])].join(",");

  const nameInput = otherOn && (
    <input
      type="text"
      value={otherName}
      onChange={(e) => onChange(multiple ? build(listed, true, e.target.value) : clean(e.target.value) || OTHER)}
      placeholder="健診の名前（任意。例: 高気圧）"
      aria-label="その他の特殊健診の名前"
      style={{ width: 210 }}
    />
  );

  if (!multiple) {
    const current = listed[0] ?? (otherOn ? OTHER : "");
    return (
      <div>
        <label>特殊健診の種類</label>
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={current} onChange={(e) => onChange(e.target.value)} aria-label="特殊健診の種類">
            <option value="">（選んでください）</option>
            {SPECIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {nameInput}
        </span>
      </div>
    );
  }

  return (
    <div style={{ flexBasis: "100%" }}>
      <label>
        特殊健診の種類
        <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
          分かるものに印を付けてください（いくつでも。分からなければ、選ばなくても送れます）
        </span>
      </label>
      <div style={{ display: "flex", gap: "6px 16px", flexWrap: "wrap", alignItems: "center" }}>
        {SPECIAL_KINDS.map((k) => {
          const on = k === OTHER ? otherOn : listed.includes(k);
          return (
            <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 400, fontSize: 14, color: "inherit", margin: 0, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  onChange(k === OTHER ? build(listed, e.target.checked, otherName) : build(e.target.checked ? [...listed, k] : listed.filter((x) => x !== k), otherOn, otherName))
                }
              />
              {k}
            </label>
          );
        })}
        {nameInput}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        {all.length === 1
          ? `このファイルは「${all[0]}」として登録します（ほかの種類の結果も入っているときは、自動で見分けて、種類ごとに分けます）。`
          : "ファイルの中身から健診の種類を見分けて、種類ごとに分けて登録します。見分けられなかった分だけ、産業医事務所が種類を選びます。"}
      </p>
    </div>
  );
}
