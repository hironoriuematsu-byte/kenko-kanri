import { createClient } from "@/lib/supabase/server";
import type { PneumoExam, PneumoWorker } from "@/lib/pneumo";

// 健康診断管理から写した受診記録の、健診側の就業判定・総合判定
export type PneumoCheckupInfo = { work_judgment: string | null; overall_judgment: string | null; fiscal_year: number | null };

// じん肺健康管理台帳(SQL 0153。0154 の列は実行後だけある)を読む。表がない環境では空にする
export async function loadPneumo(
  companyId: string
): Promise<{ workers: PneumoWorker[]; exams: PneumoExam[]; checkups: Record<string, PneumoCheckupInfo>; ready: boolean }> {
  const supabase = createClient();
  const [w, e] = await Promise.all([
    supabase.from("hm_pneumo_workers").select("*").eq("company_id", companyId).order("full_name"),
    supabase.from("hm_pneumo_exams").select("*").eq("company_id", companyId).order("exam_date"),
  ]);
  if (w.error || e.error) return { workers: [], exams: [], checkups: {}, ready: false };
  const exams = (e.data as PneumoExam[]) ?? [];
  const ids = exams.map((x) => x.checkup_id).filter((x): x is string => !!x);
  const checkups: Record<string, PneumoCheckupInfo> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("hm_checkups").select("id, work_judgment, overall_judgment, fiscal_year").in("id", ids.slice(i, i + 200));
    for (const c of (data as ({ id: string } & PneumoCheckupInfo)[] | null) ?? []) checkups[c.id] = c;
  }
  return { workers: (w.data as PneumoWorker[]) ?? [], exams, checkups, ready: true };
}
