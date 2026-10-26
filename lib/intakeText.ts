// ストレスチェックWebの事前問診(AI)の内容を、面談管理の実施記録に転記する文章にする。
// 事前問診の表(interview_intakes)は実施者(office)だけが読める(ストレスチェックWebの 0028)
export type IntakeForRecord = {
  status: string;
  risk_level: string | null;
  completed_at: string | null;
  updated_at: string | null;
  messages: { role: "assistant" | "user"; content: string }[] | null;
  summary: Record<string, unknown> | null;
};

export const INTAKE_RECORD_HEADER = "【事前問診(AI)の内容】";

const RISK: Record<string, string> = { none: "特になし", low: "低", moderate: "中", high: "高(至急の対応が必要)" };

const SUMMARY_LABELS: [string, string][] = [
  ["chief_complaint", "主な困りごと"],
  ["symptoms", "心身の状態"],
  ["stressors", "ストレス要因"],
  ["work_status", "勤務の状況"],
  ["medical", "受診・服薬"],
  ["support", "相談相手"],
  ["wishes", "本人の希望"],
  ["risk_notes", "緊急度の根拠"],
  ["points_to_confirm", "面談で確認"],
  ["measure_candidates", "就業上の措置の案"],
];
const OPINION_LABELS: [string, string][] = [
  ["work_condition", "勤務の状況"],
  ["fatigue", "疲労の蓄積"],
  ["psych_burden", "心理的な負担の状況"],
  ["other_health", "その他の心身の状況"],
  ["guidance", "指導区分(案)"],
  ["reinterview", "要再面接の時期(案)"],
  ["work_category", "就業区分(案)"],
  ["hours_measures", "労働時間の短縮(案)"],
  ["other_measures", "労働時間以外の項目(案)"],
  ["measure_period", "措置期間(案)"],
  ["environment", "職場環境の改善(案)"],
  ["medical_care", "受診配慮等(案)"],
  ["consent_notes", "意見書への本人の希望"],
  ["basis", "根拠・面談で確認"],
];

const text = (v: unknown): string => {
  if (Array.isArray(v)) return v.filter((x) => String(x ?? "").trim() !== "").map((x) => `・${x}`).join("\n");
  return String(v ?? "").trim();
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "");

export function formatIntakeForRecord(it: IntakeForRecord): string {
  const out: string[] = [];
  const state = it.status === "completed" ? `回答済み(${fmtDate(it.completed_at)})` : `回答の途中(${fmtDate(it.updated_at)}時点)`;
  out.push(`${INTAKE_RECORD_HEADER}ストレスチェックWebから転記`, `状態: ${state} / 緊急度: ${RISK[it.risk_level ?? "none"] ?? it.risk_level}`);

  const s = it.summary ?? null;
  if (s) {
    out.push("", `■ 要約(AI)${s.partial ? "※途中までの回答から作成" : ""}`);
    for (const [k, label] of SUMMARY_LABELS) {
      const v = text(s[k]);
      if (v) out.push(v.includes("\n") ? `${label}:\n${v}` : `${label}: ${v}`);
    }
    const o = (s.opinion ?? null) as Record<string, unknown> | null;
    if (o) {
      out.push("", "■ 面接指導結果報告書・意見書の下書き(AI案)");
      for (const [k, label] of OPINION_LABELS) {
        const v = text(o[k]);
        if (v) out.push(v.includes("\n") ? `${label}:\n${v}` : `${label}: ${v}`);
      }
    }
  }

  const msgs = it.messages ?? [];
  if (msgs.length > 0) {
    out.push("", "■ 会話の記録");
    for (const m of msgs) out.push(`${m.role === "user" ? "本人" : "AI"}: ${m.content}`);
  }
  return out.join("\n");
}
