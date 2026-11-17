import type { SupabaseClient } from "@supabase/supabase-js";

// 二段階認証: いまのログインが「確認済み」かどうかを調べる(サーバー専用。APIの入口で使う)

export type StepState = {
  applied: boolean; // データベースの準備(SQL 0035)が済んでいるか
  required: boolean; // この方は二段階認証の対象か
  verified: boolean; // このログインは確認済みか(対象でない方は常に true)
};

// いまのログインの状態。SQL 0035 の実行前は「準備なし・対象外」として、今までどおり動かす
export async function stepState(supabase: SupabaseClient): Promise<StepState> {
  const { data, error } = await supabase.rpc("second_step_status");
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883" || /second_step_status/.test(error.message ?? "");
    // 関数がまだ無いときだけ通す。それ以外の失敗(通信など)は、安全のため「未確認」として扱う
    return missing ? { applied: false, required: false, verified: true } : { applied: true, required: true, verified: false };
  }
  const s = (data ?? {}) as { required?: boolean; verified?: boolean };
  return { applied: true, required: Boolean(s.required), verified: Boolean(s.verified) };
}

// APIの入口で使う: このログインは、確認コードの入力がまだ済んでいないか
export async function stepBlocked(supabase: SupabaseClient): Promise<boolean> {
  const s = await stepState(supabase);
  return s.required && !s.verified;
}
export const STEP_BLOCKED_MESSAGE = "確認コードの入力が済んでいません。画面を再読み込みして、メールに届く確認コードを入力してください。";

