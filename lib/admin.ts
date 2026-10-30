import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

// service_role のクライアント(サーバーのみ。Web申込の会社登録・支払い通知の処理だけで使う)。
// 環境変数 SUPABASE_SERVICE_ROLE_KEY(ストレスチェックWebと同じ値)。絶対に NEXT_PUBLIC_ を付けない
export function adminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// 実施者(産業医事務所)のメールアドレス
export async function officeEmails(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from("profiles").select("user_id").eq("role", "office");
  const emails: string[] = [];
  for (const r of (data as { user_id: string }[] | null) ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(r.user_id);
    if (u?.user?.email) emails.push(u.user.email);
  }
  return emails;
}
