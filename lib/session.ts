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
