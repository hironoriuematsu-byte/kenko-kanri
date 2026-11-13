// 就業判定・事後措置報告書(産業医事務所が事業者に渡すもの)。PDF(印刷画面)とCSVで同じ内容を出す。
//   就業判定: 健診結果に基づく産業医の判定(通常勤務可・要就業制限・要休業・判定保留)と判定条件・医師の意見
//   事後措置: 受診勧奨(要/勧奨済/受診済/不要)・産業医面談(要/不要)・本人からの受診報告

import { CHECKUP_WORK_JUDGMENTS, FOLLOWUP_STATUS, conditionLabel } from "@/lib/checkups";
import type { CheckupRow } from "@/components/CheckupsTable";

export function judgmentLabel(r: CheckupRow): string {
  return r.work_judgment ? CHECKUP_WORK_JUDGMENTS[r.work_judgment] ?? r.work_judgment : "未判定";
}

// 受診勧奨: 措置不要は「不要」、それ以外は状態(受診勧奨・勧奨済・受診済)
export function consultLabel(r: CheckupRow): string {
  if (!r.followup_status || r.followup_status === "none") return "不要";
  return FOLLOWUP_STATUS[r.followup_status] ?? r.followup_status;
}

// 産業医面談: 要就業制限の方と、医師の意見に「産業医面談」が含まれる方は「要」
export function interviewNeeded(r: CheckupRow): boolean {
  return r.work_judgment === "restricted" || r.work_judgment === "leave" || (r.work_judgment_note ?? "").includes("産業医面談");
}

// 事後措置をまとめた短い文(印刷用)
export function followupText(r: CheckupRow): string {
  const parts: string[] = [];
  const c = consultLabel(r);
  parts.push(c === "不要" ? "受診勧奨: 不要" : `受診勧奨: ${c}`);
  parts.push(`産業医面談: ${interviewNeeded(r) ? "要" : "不要"}`);
  if (r.report) parts.push(`受診報告あり${r.report.visit_date ? `(${r.report.visit_date} 受診)` : ""}`);
  return parts.join(" / ");
}

export type WorkJudgmentSummary = {
  total: number;
  normal: number;
  normalWithCondition: number;
  restricted: number;
  leave: number;
  pending: number;
  unjudged: number;
  consult: number; // 受診勧奨が必要(受診勧奨・勧奨済・受診済)
  consultDone: number; // うち受診済
  interview: number; // 産業医面談が必要
};

export function summarize(rows: CheckupRow[]): WorkJudgmentSummary {
  const n = (f: (r: CheckupRow) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    normal: n((r) => r.work_judgment === "normal"),
    normalWithCondition: n((r) => r.work_judgment === "normal" && !!r.work_judgment_condition),
    restricted: n((r) => r.work_judgment === "restricted"),
    leave: n((r) => r.work_judgment === "leave"),
    pending: n((r) => r.work_judgment === "pending"),
    unjudged: n((r) => !r.work_judgment),
    consult: n((r) => !!r.followup_status && r.followup_status !== "none"),
    consultDone: n((r) => r.followup_status === "done"),
    interview: n(interviewNeeded),
  };
}

export const conditionText = (r: CheckupRow) => conditionLabel(r.work_judgment_condition);

export const LEGAL_NOTE =
  "就業判定と医師の意見は、健康診断の結果に基づき産業医が述べたものです。事業者はこの意見を勘案し、必要な就業上の措置をご検討ください(労働安全衛生法第66条の4・第66条の5)。";
