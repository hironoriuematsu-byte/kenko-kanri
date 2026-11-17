import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SS_GATE_PATH, SS_HINT_COOKIE, SS_VERIFY_PATH, sessionIdOf } from "@/lib/secondStep";

// ログイン不要で読めるページ。/privacy は個人情報の取扱い(安全管理措置の概要)の公表ページ、
// /demo は架空データによる紹介用デモ、/report は受診勧奨通知のQRコードから本人が受診報告を送るページ
// (本人確認は受付番号+生年月日などで行う)
// /api/second-step は二段階認証の窓口(準備状況の問い合わせはログインなしで受ける。ほかの操作は中でログインを確かめる)
const PUBLIC_PATHS = ["/login", "/privacy", "/demo", "/report", "/api/second-step"];

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

  // 二段階認証: このログインが確認済み(または確認不要)と分かっていなければ、通り道(gate)へ回す。
  // gate が、確認コードの入力画面に進むか、そのまま元の行き先へ戻すかを決める。
  // ここは画面の行き先を決めるだけで、権限そのものはデータベースが判定する
  if (user && request.method === "GET" && !isPublic && !path.startsWith("/api/") && path !== SS_VERIFY_PATH) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sid = sessionIdOf(session?.access_token);
    if (sid && request.cookies.get(SS_HINT_COOKIE)?.value !== sid) {
      const gate = new URL(SS_GATE_PATH, request.url);
      gate.searchParams.set("next", path + request.nextUrl.search);
      const redirect = NextResponse.redirect(gate);
      // 更新されたログインのCookieを引き継ぐ
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico)$).*)"],
};
