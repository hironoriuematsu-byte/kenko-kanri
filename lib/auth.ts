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

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, employee_no, department, company_id")
    .eq("id", user.id)
    .single();

  // ログイン済みなのにプロフィールが読めない場合、/loginへ戻すと
  // middlewareが / へ戻して無限リダイレクトになるため専用ページへ
  if (!profile) redirect("/profile-error");
  return { profile: profile as Profile };
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
