import { createClient } from "@/lib/supabase/server";
import type { PneumoExam, PneumoWorker } from "@/lib/pneumo";

// じん肺健康管理台帳(SQL 0153)を読む。表がない環境では空にする
export async function loadPneumo(companyId: string): Promise<{ workers: PneumoWorker[]; exams: PneumoExam[]; ready: boolean }> {
  const supabase = createClient();
  const [w, e] = await Promise.all([
    supabase
      .from("hm_pneumo_workers")
      .select(
        "id, company_id, person_id, full_name, dust_status, dust_work_code, kanri, kanri_detail, kanri_decided_on, kanri_previous, transferred_on, complication, complication_started_on, left_on, note"
      )
      .eq("company_id", companyId)
      .order("full_name"),
    supabase
      .from("hm_pneumo_exams")
      .select("id, worker_id, exam_date, exam_kind, lung_cancer, xray, note")
      .eq("company_id", companyId)
      .order("exam_date"),
  ]);
  if (w.error || e.error) return { workers: [], exams: [], ready: false };
  return { workers: (w.data as PneumoWorker[]) ?? [], exams: (e.data as PneumoExam[]) ?? [], ready: true };
}
