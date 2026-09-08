import { findLegalItemByHeader } from "@/lib/judgment";
import { isFindingJudgment } from "@/lib/checkups";

// 定期健康診断結果報告書(様式第6号)の健診項目区分。
// 保存されている検査項目名から該当区分を判定して集計する。
export const REPORT_CATEGORIES: {
  key: string;
  label: string;
  itemKeys?: string[];
  namePattern?: RegExp;
}[] = [
  { key: "hearing1000", label: "聴力検査（1000Hz）", itemKeys: ["hearing1000"] },
  { key: "hearing4000", label: "聴力検査（4000Hz）", itemKeys: ["hearing4000"] },
  { key: "hearing_other", label: "聴力検査（その他の方法）", namePattern: /聴力.*(その他|簡易|会話)/ },
  { key: "chest_xray", label: "胸部エックス線検査", namePattern: /胸部|エックス線|ｘ線|x線|レントゲン/i },
  // 喀痰検査は集計・出力しない(定期健診では実施されないことが多く、
  // 欄が常に0名で並ぶため省略する)
  { key: "bp", label: "血圧", itemKeys: ["sbp", "dbp"], namePattern: /血圧/ },
  {
    key: "anemia",
    label: "貧血検査",
    itemKeys: ["hb"],
    namePattern: /貧血|血色素|ヘモグロビン|赤血球/,
  },
  { key: "liver", label: "肝機能検査", itemKeys: ["ast", "alt", "ggt"], namePattern: /肝機能/ },
  {
    key: "lipid",
    label: "血中脂質検査",
    itemKeys: ["ldl", "hdl", "tg"],
    namePattern: /脂質|コレステロール|中性脂肪/,
  },
  {
    key: "glucose",
    label: "血糖検査",
    itemKeys: ["glucose", "hba1c", "casual_glucose"],
    namePattern: /血糖|hba1c/i,
  },
  { key: "urine_glucose", label: "尿検査（糖）", itemKeys: ["urine_glucose"], namePattern: /尿糖/ },
  {
    key: "urine_protein",
    label: "尿検査（蛋白）",
    itemKeys: ["urine_protein"],
    namePattern: /尿蛋白|尿たん白|尿タンパク/,
  },
  { key: "ecg", label: "心電図検査", namePattern: /心電図/ },
];

export type ReportItem = {
  checkup_id: string;
  item_name: string;
  value: string | null;
  judgment: string | null;
};

export function categoryOf(itemName: string): string | null {
  const key = findLegalItemByHeader(itemName);
  for (const cat of REPORT_CATEGORIES) {
    if (key && cat.itemKeys?.includes(key)) return cat.key;
  }
  for (const cat of REPORT_CATEGORIES) {
    if (cat.namePattern?.test(itemName)) return cat.key;
  }
  return null;
}

export type CategorySummary = { key: string; label: string; examined: number; findings: number };

// 区分ごとの受診者数・有所見者数(1人1区分1回として集計)
export function summarizeByCategory(items: ReportItem[]): CategorySummary[] {
  const examined = new Map<string, Set<string>>();
  const findings = new Map<string, Set<string>>();

  for (const it of items) {
    const cat = categoryOf(it.item_name);
    if (!cat) continue;
    const hasData = (it.value ?? "").trim() !== "" || (it.judgment ?? "").trim() !== "";
    if (!hasData) continue;
    if (!examined.has(cat)) examined.set(cat, new Set());
    examined.get(cat)!.add(it.checkup_id);
    if (isFindingJudgment(it.judgment)) {
      if (!findings.has(cat)) findings.set(cat, new Set());
      findings.get(cat)!.add(it.checkup_id);
    }
  }

  return REPORT_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    examined: examined.get(c.key)?.size ?? 0,
    findings: findings.get(c.key)?.size ?? 0,
  }));
}

// Excelで文字化けしないようBOM付きUTF-8でダウンロードする
export function downloadCsv(fileName: string, rows: (string | number | null)[][]) {
  const escape = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
