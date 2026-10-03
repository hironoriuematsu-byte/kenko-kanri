import { normalizeGradeText } from "@/lib/gradeText";

export const CHECKUP_TYPES: Record<string, string> = {
  regular: "定期健診",
  hiring: "雇入時健診",
  special: "特殊健診",
};

// 健診の就業判定(面談の意見書とは別に「判定保留」を持つ)
export const CHECKUP_WORK_JUDGMENTS: Record<string, string> = {
  normal: "通常勤務可",
  restricted: "要就業制限",
  leave: "要休業",
  pending: "判定保留",
};

// 就業判定の「判定条件」。要医療項目(D)・就業制限項目(R)があるのに通常勤務可とする
// 場合の条件付き判定(医師の意見とは別の欄)。値は hm_checkups.work_judgment_condition
export const WORK_JUDGMENT_CONDITIONS: Record<string, string> = {
  consult: "受診が条件",
};

export function conditionLabel(condition: string | null | undefined): string {
  return condition ? WORK_JUDGMENT_CONDITIONS[condition] ?? condition : "";
}

// 医師の意見の定型文(チェックで付与でき、自由記入と併用できる)
// 「但し受診が条件」は判定条件(WORK_JUDGMENT_CONDITIONS)に移した
export const OPINION_PRESETS = ["要産業医面談", "時間外労働月45時間以内"];

// 定型文＋自由記入 → 保存文字列
export function buildOpinionNote(presets: string[], freeText: string): string {
  return [...presets, freeText.trim()].filter(Boolean).join(" / ");
}

// 保存文字列 → 定型文＋自由記入
export function parseOpinionNote(note: string | null | undefined): {
  presets: string[];
  freeText: string;
} {
  const parts = (note ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const presets = parts.filter((p) => OPINION_PRESETS.includes(p));
  const freeText = parts.filter((p) => !OPINION_PRESETS.includes(p)).join(" / ");
  return { presets, freeText };
}

// 実施回(年に複数回の定期健診を分けて扱う)の表示
export function roundLabel(round: number | null | undefined): string {
  const r = round ?? 1;
  return r <= 1 ? "" : `第${r}回`;
}

// 就業判定が「要対応」(未判定・判定保留)か
export function needsAttention(workJudgment: string | null | undefined): boolean {
  return !workJudgment || workJudgment === "pending";
}

export const FOLLOWUP_STATUS: Record<string, string> = {
  none: "措置不要",
  pending: "受診勧奨",
  recommended: "勧奨済",
  done: "受診済",
};

// 有所見とみなす総合判定・項目判定(取込時の既定値)
export const DEFAULT_FINDINGS_JUDGMENTS = ["C", "D", "E", "R"];

// 判定文字が有所見に当たるか(C/D/E/R で始まるものを有所見扱い)。
// 「要観察」「要精密検査」のような文言の判定も A〜E に読み替えて扱う(lib/gradeText)
export function isFindingJudgment(judgment: string | null | undefined): boolean {
  if (!judgment) return false;
  const g = normalizeGradeText(judgment) ?? judgment.trim();
  return /^[CDER]/i.test(g);
}

// 就業制限の検討が必要な水準(R)か。
// 厚生労働科学研究「健康診断の有所見者に対して、健康管理を行う事を目的とした、
// 産業医による就業上の意見に関する実態調査、およびコンセンサス調査」で
// コンセンサスが得られた値を超えたことを表す。
export function isRestrictionJudgment(judgment: string | null | undefined): boolean {
  if (!judgment) return false;
  return /^R/i.test(judgment.trim());
}

// 産業医が個別に就業判定すべき重度判定(D)か
// ※ 過去に健診機関の判定でEが入っているデータも同様に扱う
//   Rは就業制限の検討が必要な水準のため、当然に個別判定の対象とする
export function isSevereJudgment(judgment: string | null | undefined): boolean {
  if (!judgment) return false;
  const g = normalizeGradeText(judgment) ?? judgment.trim();
  return /^[DER]/i.test(g);
}

// シンプルなCSVパーサ(ダブルクォート・改行・BOM対応)
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// UTF-8/Shift_JIS 自動判別でファイルを読む
export async function readCsvFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

// 「2026/6/1」「2026-06-01」「20260601」等を YYYY-MM-DD に正規化
// 元号(明治・大正・昭和・平成・令和)の開始年
const ERA_BASE: Record<string, number> = { M: 1867, 明治: 1867, T: 1911, 大正: 1911, S: 1925, 昭和: 1925, H: 1988, 平成: 1988, R: 2018, 令和: 2018 };

// 日付の表記を YYYY-MM-DD にそろえる。健診機関のCSVで見かける次の表記に対応する:
//   2026/9/1、2026-09-01、2026.9.1、20260901、2026年9月1日、
//   S45.3.12、昭和45年3月12日、R7/9/1、令和7年9月1日、全角数字、Excelのシリアル値(例: 46176)
export function normalizeDate(s: string): string | null {
  const t = (s ?? "").normalize("NFKC").trim().replace(/\s+/g, "");
  if (!t) return null;
  const pad = (v: string | number) => String(v).padStart(2, "0");
  const ok = (y: number, mo: number, d: number) =>
    y >= 1868 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null;

  let m = t.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/);
  if (m) return ok(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return ok(Number(m[1]), Number(m[2]), Number(m[3]));
  // 和暦: S45.3.12 / 昭和45年3月12日 / R7/9/1 / 令和元年5月1日
  m = t.match(/^(明治|大正|昭和|平成|令和|[MTSHR])\.?(元|\d{1,2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/i);
  if (m) {
    const base = ERA_BASE[m[1].toUpperCase()] ?? ERA_BASE[m[1]];
    const yy = m[2] === "元" ? 1 : Number(m[2]);
    if (base != null) return ok(base + yy, Number(m[3]), Number(m[4]));
  }
  // Excel のシリアル値(1900年起点)。1950〜2100年の範囲だけを日付として扱う
  if (/^\d{5}$/.test(t)) {
    const serial = Number(t);
    if (serial >= 18264 && serial <= 73415) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return ok(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return null;
}
