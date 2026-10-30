import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mailConfigured, sendMails } from "@/lib/mail";
import { SERVICE_NAME } from "@/lib/iken";
import { DOCTOR, SELLER } from "@/lib/org";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 意見聴取の結果の返却(実施者のみ)。その事業場の未返却の受付を返却済みにし、担当者にメールで知らせる。
//   preview=true: 送り先の氏名だけを返す
//   メールには個人の氏名・健康情報を書かず、詳細は健康管理Webで確認してもらう
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインの有効期限が切れました。ページを再読み込みしてください。" }, { status: 401 });

  let body: { companyId?: unknown; preview?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  if (!companyId) return NextResponse.json({ error: "事業場が指定されていません" }, { status: 400 });

  const { data: targets, error } = await supabase.rpc("hm_iken_report_targets", { p_company_id: companyId });
  if (error) {
    const msg = /office only|permission/.test(error.message)
      ? "返却できるのは産業医事務所だけです。"
      : /function|schema cache/i.test(error.message)
        ? "SQL 0152 が未実行です。Supabase の SQL Editor で実行してください。"
        : `送り先を取得できませんでした: ${error.message}`;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const list = ((targets as { name: string | null; email: string }[] | null) ?? []).filter((t) => t.email);
  if (body.preview === true) return NextResponse.json({ names: list.map((t) => t.name || t.email) });

  const { data: count, error: retErr } = await supabase.rpc("hm_iken_return", { p_company_id: companyId });
  if (retErr) return NextResponse.json({ error: `返却済みにできませんでした: ${retErr.message}` }, { status: 400 });

  let sent = 0;
  if (list.length > 0 && mailConfigured()) {
    const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || new URL(req.url).origin;
    sent = await sendMails(
      list.map((t) => t.email),
      `【${SERVICE_NAME}】健康診断結果の就業判定(医師の意見)が出ました`,
      [
        `${company?.name ?? ""} ご担当者さま`,
        "",
        "お送りいただいた健康診断結果について、産業医の就業判定と意見の入力が終わりました。",
        "健康管理Webにログインして、「健康診断管理」からご確認ください。",
        "",
        "■ ご確認いただきたいこと",
        "・就業判定結果の一覧(「就業判定結果」のCSV出力・印刷)",
        "・受診が必要な方への受診勧奨通知書(「受診勧奨通知書」から1人1ページで印刷)",
        "・就業制限・要休業の方がいる場合は、医師の意見を踏まえ、本人の事情も考慮して就業上の措置を決めてください",
        "・医師の意見は健康診断個人票に記載し、5年間保存してください",
        "",
        `${origin}/company/checkups`,
        "",
        "※このメールには、従業員の方の氏名や健康に関する情報は記載していません。",
        "",
        `${DOCTOR.full}(${DOCTOR.officeName})`,
        `お問い合わせ: ${SELLER.email}`,
      ].join("\n")
    );
  }
  return NextResponse.json({ returned: count ?? 0, sent, recipients: list.length });
}
