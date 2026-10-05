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

// 「17 A」「0.9 B」のように数値の右に判定記号が付いた表記を、値と判定に分ける
// (有機溶剤健診のAST・ALT・γ-GTP など)。判定が無ければ grade は null
export function splitValueGrade(text: string | null | undefined): { value: string; grade: GradeLetter | null } {
  const t = String(text ?? "").normalize("NFKC").trim();
  const m = t.match(/^(.*?\d)\s*([A-ERa-er])$/);
  if (m) return { value: m[1].trim(), grade: m[2].toUpperCase() as GradeLetter };
  return { value: t, grade: null };
}

// 生物学的モニタリング(尿中馬尿酸 など)の分布区分。
// 「0.16①」「0.16 (1)」「0.16 1」「2」のように数値の右または単独で 1〜3 が書かれる。
//   分布1 → A(基準値内)、分布2 → B(基準値を超えるが要注意)、分布3 → C(要措置)
const DIST_GRADE: Record<string, GradeLetter> = { "1": "A", "2": "B", "3": "C" };
export function splitDistribution(text: string | null | undefined): { value: string; dist: string | null; grade: GradeLetter | null } {
  const raw = String(text ?? "").trim();
  // 丸数字(NFKC で ①→1 になるため、先に見ておく)
  const circled = raw.match(/[①②③]/);
  let t = raw.normalize("NFKC").trim();
  let dist: string | null = null;
  if (circled) {
    dist = { "①": "1", "②": "2", "③": "3" }[circled[0]] ?? null;
    t = raw.replace(/[①②③]/g, "").trim();
  } else {
    // 単独の「1」〜「3」、または「0.16 (1)」「0.16 1」「0.16-2」のように値と区分が区切られている場合だけ読む
    // (「0.5」のような小数の末尾を分布と誤認しない)
    const alone = t.match(/^([123])$/);
    const sep = t.match(/^(.*?\S)[\s(（\-\/]+([123])[)）]?$/);
    if (alone) {
      dist = alone[1];
      t = "";
    } else if (sep) {
      dist = sep[2];
      t = sep[1].trim();
    }
  }
  return { value: t, dist, grade: dist ? DIST_GRADE[dist] : null };
}
