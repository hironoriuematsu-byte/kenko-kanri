import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ログイン不要で読めるページ。/privacy は個人情報の取扱い(安全管理措置の概要)の公表ページ、
// /demo は架空データによる紹介用デモ、/report は受診勧奨通知のQRコードから本人が受診報告を送るページ
// (本人確認は受付番号+生年月日などで行う)
// /iken は健診結果の医師意見聴取Web(50人未満向け)の宣伝・会社登録・規約のページ。
// /auth/callback は登録確認メールのリンク、/api/iken/signup・/api/iken/webhook は会社登録と Stripe からの支払い通知
const PUBLIC_PATHS = ["/login", "/privacy", "/demo", "/report", "/iken", "/auth/callback", "/api/iken/signup", "/api/iken/webhook"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            // maxAge/expiresを落としてセッションCookieにする
            const { maxAge, expires, ...rest } = options ?? {};
            response.cookies.set(name, value, rest);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico)$).*)"],
};
