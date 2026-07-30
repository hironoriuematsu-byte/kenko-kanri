export const INTERVIEW_TYPES: Record<string, string> = {
  high_stress: "高ストレス面接指導",
  long_hours: "長時間労働面談",
  checkup_followup: "健診事後措置面談",
  return_to_work: "復職面談",
  other: "その他相談",
};

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
  restricted: "就業制限が必要",
  leave: "要休業",
};

export function formatDateTimeJa(ts: string | null | undefined): string {
  if (!ts) return "未定";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const h = d.getHours();
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${h}:${min}`;
}

// timestamptz → <input type="datetime-local"> 用のローカル表記
export function toDatetimeLocal(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
