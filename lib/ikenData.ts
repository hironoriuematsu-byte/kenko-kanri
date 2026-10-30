import type { SupabaseClient } from "@supabase/supabase-js";
import { currentFiscalYearJst } from "@/lib/iken";
import { returnDueDate } from "@/lib/businessDays";

// 健診結果の医師意見聴取Web: 事業場の申込状況(担当者・実施者の画面で共通に使う)

export type IkenCompany = {
  company_id: string;
  office_name: string;
  address: string | null;
  workers: number | null;
  work_info: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
};
export type IkenOrder = {
  id: string;
  kind: "new" | "add";
  status: string;
  fiscal_year: number;
  seats: number;
  seats_granted: number;
  amount: number;
  created_at: string;
  paid_at: string | null;
};
export type IkenJob = { id: string; file_name: string | null; received_at: string; returned_at: string | null; due: string };
export type IkenState = {
  info: IkenCompany;
  fiscalYear: number;
  seats: number;
  used: number;
  orders: IkenOrder[];
  jobs: IkenJob[];
};

// Web申込の事業場でなければ null(テーブルが未作成の環境でも null)
export async function loadIkenState(supabase: SupabaseClient, companyId: string, fiscalYear = currentFiscalYearJst()): Promise<IkenState | null> {
  const { data: info, error } = await supabase.from("hm_iken_companies").select("*").eq("company_id", companyId).maybeSingle();
  if (error || !info) return null;
  const [{ data: status }, { data: orders }, { data: jobs }] = await Promise.all([
    supabase.rpc("hm_iken_status", { p_company_id: companyId, p_fiscal_year: fiscalYear }),
    supabase
      .from("hm_iken_orders")
      .select("id, kind, status, fiscal_year, seats, seats_granted, amount, created_at, paid_at")
      .eq("company_id", companyId)
      .in("status", ["paid", "pending"])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("hm_iken_jobs")
      .select("id, file_name, received_at, returned_at")
      .eq("company_id", companyId)
      .order("received_at", { ascending: false })
      .limit(30),
  ]);
  const st = ((status as { seats: number; used: number }[] | null) ?? [])[0] ?? { seats: 0, used: 0 };
  return {
    info: info as IkenCompany,
    fiscalYear,
    seats: st.seats,
    used: st.used,
    orders: ((orders as IkenOrder[] | null) ?? []).filter((o) => o.status === "paid" || Date.now() - new Date(o.created_at).getTime() < 86400000),
    jobs: ((jobs as Omit<IkenJob, "due">[] | null) ?? []).map((j) => ({ ...j, due: returnDueDate(new Date(j.received_at)) })),
  };
}

// Web申込の事業場かどうかだけを調べる(メニューの出し分け用)
export async function isIkenCompany(supabase: SupabaseClient, companyId: string): Promise<boolean> {
  const { data, error } = await supabase.from("hm_iken_companies").select("company_id").eq("company_id", companyId).maybeSingle();
  return !error && Boolean(data);
}
