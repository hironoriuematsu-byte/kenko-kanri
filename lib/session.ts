"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

// 保存などの操作の直前にログイン状態を確かめ、期限切れなら更新を試みる。
// 長い文章を入力している間にアクセストークン(1時間)が切れると、保存時の呼び出しが
// 未ログイン扱いになり「not authenticated」で失敗するため、その前に手当てする。
// 戻り値: true = 有効なセッションあり / false = 再ログインが必要
export async function ensureSession(supabase: SupabaseClient): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    // 期限が近い(5分以内)か既に切れていれば更新する
    const exp = (session.expires_at ?? 0) * 1000;
    if (exp - Date.now() > 5 * 60 * 1000) return true;
  }
  const { data, error } = await supabase.auth.refreshSession();
  return !error && !!data.session;
}

// ログイン中の利用者ID。ブラウザに保存されたセッションから取る(サーバーへの問い合わせなし)。
// 以前は保存のたびに auth.getUser() でサーバーに確認していたため、保存に余分な待ち時間が出ていた
export async function currentUserId(supabase: SupabaseClient): Promise<string | undefined> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user?.id) return session.user.id;
  const { data } = await supabase.auth.getUser();
  return data.user?.id;
}

// アクセスログの記録を待たずに次へ進む(記録は裏で行う。失敗しても画面の操作は止めない)
export function logAccessInBackground(
  supabase: SupabaseClient,
  params: { p_action: string; p_target_table: string; p_target_id: string | null; p_detail?: unknown }
) {
  void supabase
    .rpc("hm_log_access", params)
    .then(() => undefined, () => undefined);
}

// RPC などのエラーが「未ログイン」由来かどうか
export function isAuthError(message: string | undefined | null): boolean {
  return /not authenticated|jwt|expired|401|invalid claim|permission denied/i.test(message ?? "");
}

// 未保存の入力を一時的にブラウザに残す(再ログイン後に復元する)。
// 個人情報を含むため、復元後や保存成功時に必ず消す
const DRAFT_PREFIX = "hm-draft:";
export function saveDraft(key: string, value: string) {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + key, value);
  } catch {
    /* ストレージが使えない環境では何もしない */
  }
}
export function takeDraft(key: string): string | null {
  try {
    const v = sessionStorage.getItem(DRAFT_PREFIX + key);
    if (v !== null) sessionStorage.removeItem(DRAFT_PREFIX + key);
    return v;
  } catch {
    return null;
  }
}
export function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    /* noop */
  }
}
