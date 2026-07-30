import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// サーバー側クライアント。Cookie書き込み時に maxAge / expires を
// 落としてセッションスコープにする(既存ストレスチェックWebと同じ方針)
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              const { maxAge, expires, ...rest } = options ?? {};
              cookieStore.set(name, value, rest);
            }
          } catch {
            // Server Componentからのset呼び出しは無視(middlewareが更新を担う)
          }
        },
      },
    }
  );
}
