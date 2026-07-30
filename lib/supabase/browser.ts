"use client";

import { createBrowserClient } from "@supabase/ssr";

// 認証Cookieはセッションスコープ(ブラウザ終了で失効)にするため
// maxAge / expires を落とす(既存ストレスチェックWebと同じ方針)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return document.cookie
            .split("; ")
            .filter(Boolean)
            .map((c) => {
              const i = c.indexOf("=");
              return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) };
            });
        },
        setAll(cookies: { name: string; value: string }[]) {
          for (const { name, value } of cookies) {
            // 有効期限を付けない = セッションCookie
            document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax${
              location.protocol === "https:" ? "; Secure" : ""
            }`;
          }
        },
      },
    }
  );
}
