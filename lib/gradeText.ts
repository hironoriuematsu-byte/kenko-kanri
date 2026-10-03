// 健診機関の判定表記を A〜E(・R)にそろえる。
// 「B1」「C-2」のような記号付き、「要観察」「要精密検査」のような指導区分の文言に対応する

export type GradeLetter = "A" | "B" | "C" | "D" | "E" | "R";

const WORD_RULES: [RegExp, GradeLetter][] = [
  // 重いものから先に判定する(「要精密検査・要治療」のように併記されることがあるため)
  [/治療中|加療中|通院中|服薬中|経過観察中/, "E"],
  [/要精密|要精査|要精検|精密検査|精査|要治療|要医療|要受診|受診勧奨|要加療/, "D"],
  [/要観察|要経過観察|経過観察|要再検|再検査|要注意|生活改善|要指導|軽度異常\(要|境界/, "C"],
  [/軽度異常|軽度|わずかに異常|ほぼ正常|日常生活に支障なし|所見あり|有所見/, "B"],
  [/異常なし|異常無|正常|所見なし|所見無|問題なし|基準範囲内/, "A"],
];

export function normalizeGradeText(text: string | null | undefined): GradeLetter | null {
  if (text == null) return null;
  const t = String(text).normalize("NFKC").trim();
  if (!t) return null;
  // 先頭の英字(A〜E・R)で始まる表記: "B", "b", "C1", "D-2", "A（異常なし）"
  const m = t.match(/^([A-ERa-er])(?![A-Za-z])/);
  if (m) return m[1].toUpperCase() as GradeLetter;
  for (const [re, g] of WORD_RULES) {
    if (re.test(t)) return g;
  }
  return null;
}

// 表示用: 判定が A〜E でなければ「C（要観察）」のように元の表記を添える
export function gradeLabel(text: string | null | undefined): string {
  if (text == null || String(text).trim() === "") return "—";
  const g = normalizeGradeText(text);
  const raw = String(text).normalize("NFKC").trim();
  if (!g) return raw;
  // 「B」「C1」「A(異常なし)」のように先頭が判定記号ならそのまま、文言だけなら記号を添える
  if (raw.toUpperCase().startsWith(g)) return raw;
  return `${g}（${raw}）`;
}
