import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  role: "office" | "jimu" | "employee" | "company";
  full_name: string | null;
  employee_no: string | null;
  department: string | null;
  company_id: string | null;
};

// ログイン済みユーザーとプロフィールを取得(未ログインは/loginへ)
export async function requireProfile(): Promise<{ profile: Profile }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const COLS = "id, role, full_name, employee_no, department, company_id";
  // hm_company_access = true の人は、ストレスチェックWebでは実施事務従事者・
  // 従業員のままで、健康管理Webでは事業者担当者として扱う(兼務への対応)
  let { data: profile } = await supabase
    .from("profiles")
    .select(`${COLS}, hm_company_access`)
    .eq("id", user.id)
    .single();

  // 列がまだ無い環境(ストレスチェックWebの0017が未適用)でも動くようにする
  if (!profile) {
    ({ data: profile } = await supabase.from("profiles").select(COLS).eq("id", user.id).single());
  }

  // ログイン済みなのにプロフィールが読めない場合、/loginへ戻すと
  // middlewareが / へ戻して無限リダイレクトになるため専用ページへ
  if (!profile) redirect("/profile-error");

  const p = profile as Profile & { hm_company_access?: boolean };
  const role: Profile["role"] =
    p.hm_company_access && (p.role === "employee" || p.role === "jimu") ? "company" : p.role;
  return { profile: { ...p, role } };
}

export function homePathFor(role: Profile["role"]): string {
  switch (role) {
    case "office":
      return "/office";
    case "company":
      return "/company";
    case "employee":
      return "/my";
    default:
      return "/unavailable"; // jimu: 本システムは対象外
  }
}
