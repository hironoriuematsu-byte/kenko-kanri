export const CHECKUP_TYPES: Record<string, string> = {
  regular: "定期健診",
  hiring: "雇入時健診",
  special: "特殊健診",
};

export const FOLLOWUP_STATUS: Record<string, string> = {
  none: "対象外",
  pending: "未対応",
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

// 就業判定を要する重度判定(D/E)か
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
