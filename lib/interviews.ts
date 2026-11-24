export const INTERVIEW_TYPES: Record<string, string> = {
  high_stress: "高ストレス面接指導",
  long_hours: "長時間労働面談",
  checkup_followup: "健診事後措置面談",
  return_to_work: "復職面談",
  return_followup: "復職後フォローアップ面談",
  other: "その他・健康相談等",
  situation_opinion: "面談後の追加意見",
};

// 前回の面談の後の経過(復職後に体調が変わった など)を受けて、あらためて面談をせずに
// 産業医意見書を出し直す記録(SQL 0162)。前回の面談の意見の続きとして扱う。
// 面談と同じ表(hm_interviews / hm_interview_opinions)に保存し、画面と帳票の文言だけを切り替える
export const SITUATION_OPINION = "situation_opinion";
export function isOpinionOnly(interviewType: string | null | undefined): boolean {
  return interviewType === SITUATION_OPINION;
}

// 状態の表示名。追加意見は「実施済」ではなく「発行済」と表す
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

// 追加意見のもとになる「前回の面談」(同じ人の、実施済の面談のうち直近のもの)。
// 見つからなければ null。面談日は意見書の面談実施日を優先し、無ければ予定日を使う
export type PreviousInterview = { id: string; interview_type: string; date: string | null };
export async function findPreviousInterview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  iv: { id: string; person_id: string | null; scheduled_at: string | null }
): Promise<PreviousInterview | null> {
  if (!iv.person_id) return null;
  let q = supabase
    .from("hm_interviews")
    .select("id, interview_type, scheduled_at")
    .eq("person_id", iv.person_id)
    .eq("status", "done")
    .neq("interview_type", SITUATION_OPINION)
    .neq("id", iv.id)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (iv.scheduled_at) q = q.lte("scheduled_at", iv.scheduled_at);
  const { data: rows } = await q;
  const prev = rows?.[0];
  if (!prev) return null;
  const { data: op } = await supabase
    .from("hm_interview_opinions")
    .select("interview_date")
    .eq("interview_id", prev.id)
    .maybeSingle();
  return {
    id: prev.id,
    interview_type: prev.interview_type,
    date: (op?.interview_date as string | null) ?? toDatetimeLocal(prev.scheduled_at) ?? null,
  };
}
