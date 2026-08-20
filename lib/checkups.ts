export const CHECKUP_TYPES: Record<string, string> = {
  regular: "定期健診",
  hiring: "雇入時健診",
  special: "特殊健診",
};

// 健診の就業判定(面談の意見書とは別に「判定保留」を持つ)
export const CHECKUP_WORK_JUDGMENTS: Record<string, string> = {
  normal: "通常勤務可",
  restricted: "就業制限が必要",
  leave: "要休業",
  pending: "判定保留",
};

// 医師の意見の定型文(チェックで付与でき、自由記入と併用できる)
export const OPINION_PRESETS = ["但し受診が条件", "要産業医面談"];

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
export const DEFAULT_FINDINGS_JUDGMENTS = ["C", "D", "E"];

// 判定文字が有所見に当たるか(C/D/E で始まるものを有所見扱い)
export function isFindingJudgment(judgment: string | null | undefined): boolean {
  if (!judgment) return false;
  return /^[CDE]/i.test(judgment.trim());
}

// 産業医が個別に就業判定すべき重度判定(D)か
// ※ 過去に健診機関の判定でEが入っているデータも同様に扱う
export function isSevereJudgment(judgment: string | null | undefined): boolean {
  if (!judgment) return false;
  return /^[DE]/i.test(judgment.trim());
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
export function normalizeDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
