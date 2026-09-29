"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

const IDLE_LIMIT_MS = 20 * 60 * 1000; // 20分無操作で自動ログアウト(既存と同じ)

export default function AutoLogout() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const logout = async () => {
      await supabase.auth.signOut();
      router.replace("/login?timeout=1");
    };

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, IDLE_LIMIT_MS);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();

    // 長い入力中にログインの有効期限(1時間)が切れないよう、操作が続いている間は定期的に更新する。
    // 画面に戻ってきたとき(タブ切替・スリープ復帰)にも確認する
    const keepAlive = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const exp = (session.expires_at ?? 0) * 1000;
        if (exp - Date.now() < 15 * 60 * 1000) await supabase.auth.refreshSession();
      } catch {
        /* 保存時の確認(lib/session.ts)で改めて扱う */
      }
    };
    const keepAliveTimer = setInterval(keepAlive, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") keepAlive();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, reset));
      clearInterval(keepAliveTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
