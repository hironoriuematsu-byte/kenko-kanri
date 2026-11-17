import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// サーバーの処理専用のクライアント(利用者の権限を確かめたあとの、取込・読み取り結果の保存に使う)。
// 環境変数 SUPABASE_SERVICE_ROLE_KEY が未設定なら null(自動読み取りは「準備中」になる)
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
