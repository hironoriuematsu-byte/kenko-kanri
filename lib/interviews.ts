export const INTERVIEW_TYPES: Record<string, string> = {
  high_stress: "高ストレス面接指導",
  long_hours: "長時間労働面談",
  checkup_followup: "健診事後措置面談",
  return_to_work: "復職面談",
  return_followup: "復職後フォローアップ面談",
  other: "その他・健康相談等",
  situation_opinion: "状況に基づく産業医意見（面談なし）",
};

// 面談を行わず、事業場からの報告などの状況をもとに産業医意見書だけを出す記録(SQL 0162)。
// 面談と同じ表(hm_interviews / hm_interview_opinions)に保存し、画面と帳票の文言だけを切り替える
export const SITUATION_OPINION = "situation_opinion";
export function isOpinionOnly(interviewType: string | null | undefined): boolean {
  return interviewType === SITUATION_OPINION;
}

// 状態の表示名。面談なしの意見は「実施済」ではなく「発行済」と表す
export function interviewStatusLabel(status: string, interviewType?: string | null): string {
  if (isOpinionOnly(interviewType)) {
    if (status === "scheduled") return "作成中";
    if (status === "done") return "発行済";
    if (status === "cancelled") return "取消";
  }
  return INTERVIEW_STATUS[status] ?? status;
}

export const INTERVIEW_METHODS: Record<string, string> = {
  in_person: "対面",
  online: "オンライン",
  phone: "電話",
};

export const INTERVIEW_STATUS: Record<string, string> = {
  scheduled: "予定",
  done: "実施済",
  cancelled: "中止",
};

export const WORK_JUDGMENTS: Record<string, string> = {
  normal: "通常勤務可",
  restricted: "要就業制限",
  leave: "要休業",
};

// 面談予定は日付のみを扱う
export function formatDateTimeJa(ts: string | null | undefined): string {
  if (!ts) return "未定";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// timestamptz → <input type="date"> 用のローカル表記
export function toDatetimeLocal(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
