// 事務所独自の自動判定(A〜D)。労働安全衛生法の法定健診項目のみを対象とする。
// E(治療中)は判定しない。複数該当・複数項目異常のときは最も重い判定を採用する。

export type JudgmentRule = {
  id?: string;
  item_key: string;
  item_label: string;
  unit: string | null;
  sex: "all" | "male" | "female";
  grade: "B" | "C" | "D" | "R";
  min_value: number | null;
  max_value: number | null;
  match_text: string | null;
  sort_order: number;
};

// R = 就業制限の検討が必要な水準(厚生労働科学研究のコンセンサス値)。
// A〜Dの延長ではなく「就業上の措置を検討する段階」を表すため、最も重く扱う。
export type Grade = "A" | "B" | "C" | "D" | "R";

const ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, R: 4 };

// 総合判定はA〜Dで表すため、Rは総合判定としてはDに読み替える
export function overallGrade(grade: Grade | null): Exclude<Grade, "R"> | null {
  if (!grade) return null;
  return grade === "R" ? "D" : grade;
}

export function worstGrade(grades: (Grade | null | undefined)[]): Grade | null {
  let worst: Grade | null = null;
  for (const g of grades) {
    if (!g) continue;
    if (!worst || ORDER[g] > ORDER[worst]) worst = g;
  }
  return worst;
}

// 法定健診項目(自動判定の対象)。aliasesはCSV見出しの自動推定に使用
export const LEGAL_ITEMS: {
  key: string;
  label: string;
  unit?: string;
  sexSpecific?: boolean;
  aliases: string[];
}[] = [
  { key: "bmi", label: "BMI", unit: "kg/m2", aliases: ["bmi", "肥満度"] },
  { key: "waist", label: "腹囲", unit: "cm", sexSpecific: true, aliases: ["腹囲", "ウエスト"] },
  { key: "vision", label: "視力（悪い側）", aliases: ["視力"] },
  { key: "hearing1000", label: "聴力 1000Hz", unit: "dB", aliases: ["1000hz", "1000ｈｚ"] },
  { key: "hearing4000", label: "聴力 4000Hz", unit: "dB", aliases: ["4000hz", "4000ｈｚ"] },
  { key: "sbp", label: "収縮期血圧", unit: "mmHg", aliases: ["収縮期", "最高血圧", "sbp"] },
  { key: "dbp", label: "拡張期血圧", unit: "mmHg", aliases: ["拡張期", "最低血圧", "dbp"] },
  { key: "ast", label: "AST(GOT)", unit: "U/L", aliases: ["ast", "got"] },
  { key: "alt", label: "ALT(GPT)", unit: "U/L", aliases: ["alt", "gpt"] },
  { key: "ggt", label: "γ-GT(γ-GTP)", unit: "U/L", aliases: ["γ-gt", "γ-gtp", "ggt", "gtp"] },
  { key: "tg", label: "中性脂肪(TG)", unit: "mg/dL", aliases: ["中性脂肪", "tg", "トリグリセ"] },
  { key: "hdl", label: "HDLコレステロール", unit: "mg/dL", aliases: ["hdl"] },
  { key: "ldl", label: "LDLコレステロール", unit: "mg/dL", aliases: ["ldl"] },
  { key: "glucose", label: "空腹時血糖(FPG)", unit: "mg/dL", aliases: ["空腹時血糖", "fpg", "血糖", "glu"] },
  { key: "casual_glucose", label: "随時血糖", unit: "mg/dL", aliases: ["随時血糖", "随時"] },
  { key: "hba1c", label: "HbA1c(NGSP)", unit: "%", aliases: ["hba1c", "ヘモグロビンa1c"] },
  {
    key: "cre",
    label: "クレアチニン",
    unit: "mg/dL",
    sexSpecific: true,
    aliases: ["クレアチニン", "cre", "crea", "creatinine"],
  },
  {
    key: "rbc",
    label: "赤血球数",
    unit: "×10^4/μL",
    sexSpecific: true,
    aliases: ["赤血球数", "赤血球", "rbc"],
  },
  {
    key: "hb",
    label: "血色素量(Hb)",
    unit: "g/dL",
    sexSpecific: true,
    aliases: ["血色素", "血液素量", "ヘモグロビン", "hgb", "hb"],
  },
  { key: "urine_glucose", label: "尿糖", aliases: ["尿糖"] },
  { key: "urine_protein", label: "尿蛋白", aliases: ["尿蛋白", "尿たん白", "尿タンパク"] },
];

// 見出しの表記ゆれを吸収する。
// NFKC正規化により、半角カナ(ﾍﾓｸﾞﾛﾋﾞﾝ)は全角カナ(ヘモグロビン)に、
// 全角英数(ＢＭＩ)は半角(BMI)に揃う。健診機関のCSVは半角カナが多い。
function normalizeHeader(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s　()（）]/g, "");
}

export function findLegalItemByHeader(header: string): string | null {
  const h = normalizeHeader(header);
  // 「HbA1c」を「Hb」より優先するため、別名の長い順に判定する
  const candidates = LEGAL_ITEMS.flatMap((it) =>
    it.aliases.map((a) => ({ key: it.key, alias: normalizeHeader(a) }))
  ).sort((a, b) => b.alias.length - a.alias.length);
  for (const c of candidates) {
    if (h.includes(c.alias)) return c.key;
  }
  return null;
}

// 「142/90」のような血圧表記を分解する
export function splitBloodPressure(value: string): { sbp?: number; dbp?: number } {
  const m = value.match(/(\d+(?:\.\d+)?)\s*[\/／]\s*(\d+(?:\.\d+)?)/);
  if (!m) return {};
  return { sbp: Number(m[1]), dbp: Number(m[2]) };
}

export function parseNumber(value: string): number | null {
  const m = value.replace(/[,\s　]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// 尿定性の表記ゆれを正規化 (-, ±, +, 2+, 3+)
export function normalizeQualitative(value: string): string {
  const v = value.trim().replace(/[\s　]/g, "").replace(/[＋]/g, "+").replace(/[－ー−]/g, "-");
  if (/^\(?-\)?$|^陰性$/.test(v)) return "-";
  if (/^\(?±\)?$|^擬陽性$|^疑陽性$/.test(v)) return "±";
  const m = v.match(/^\(?(\d)?\+{1,4}\)?$/);
  if (m) {
    const plusCount = (v.match(/\+/g) ?? []).length;
    const n = m[1] ? Number(m[1]) : plusCount;
    return n <= 1 ? "+" : `${n}+`;
  }
  return v;
}

// 1項目の判定。該当ルールがなければ A
export function judgeItem(
  itemKey: string,
  rawValue: string,
  sex: "male" | "female" | null,
  rules: JudgmentRule[]
): Grade | null {
  const applicable = rules.filter(
    (r) => r.item_key === itemKey && (r.sex === "all" || (sex != null && r.sex === sex))
  );
  if (applicable.length === 0) return null; // 基準未設定の項目は判定しない

  const isQualitative = applicable.some((r) => r.match_text);
  const hits: Grade[] = [];

  if (isQualitative) {
    const v = normalizeQualitative(rawValue);
    if (v === "-" || v === "") return "A";
    for (const r of applicable) {
      if (r.match_text && normalizeQualitative(r.match_text) === v) hits.push(r.grade);
    }
    // 3+以上など基準にない強陽性は最も重い判定に寄せる
    if (hits.length === 0 && /\+/.test(v)) {
      const worst = worstGrade(applicable.map((r) => r.grade));
      if (worst) hits.push(worst);
    }
  } else {
    let num = parseNumber(rawValue);
    if (num == null) return null;
    // 赤血球数は ×10^4/μL(例: 450)で扱う。×10^6/μL(例: 4.50)で
    // 報告されることがあるため、桁が明らかに違う場合は換算する
    if (itemKey === "rbc" && num < 100) num = num * 100;
    for (const r of applicable) {
      const okMin = r.min_value == null || num >= r.min_value;
      const okMax = r.max_value == null || num <= r.max_value;
      if (okMin && okMax) hits.push(r.grade);
    }
  }

  return worstGrade(hits) ?? "A";
}
