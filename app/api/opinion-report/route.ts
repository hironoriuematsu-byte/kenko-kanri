import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mailConfigured, sendMail, sleep } from "@/lib/mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 意見書の発行を、その企業の事業者担当者にメールで知らせる(実施者のみ)。
//   preview=true: 送り先の氏名だけを返す(確認の画面に出す)
//   メールには対象の方の氏名・健康情報を書かず、詳細は健康管理Webで確認してもらう
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインの有効期限が切れました。ページを再読み込みしてください。" }, { status: 401 });

  let body: { interviewId?: unknown; preview?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const interviewId = typeof body.interviewId === "string" ? body.interviewId : "";
  if (!interviewId) return NextResponse.json({ error: "面談が指定されていません" }, { status: 400 });

  // 送り先(実施者のみ・公開済みの意見書のみ。RPC の中で確かめる)
  const { data: targets, error } = await supabase.rpc("hm_opinion_report_targets", { p_interview_id: interviewId });
  if (error) {
    const msg = /not published/.test(error.message)
      ? "意見書がまだ企業側に公開されていません。「企業側に公開し、面談を実施済にする」を付けて保存してから送ってください。"
      : /office only|permission/.test(error.message)
        ? "メールで報告できるのは産業医事務所だけです。"
        : /function|schema cache/i.test(error.message)
          ? "SQL 0151 が未実行です。Supabase の SQL Editor で実行してください。"
          : `送り先を取得できませんでした: ${error.message}`;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const list = ((targets as { name: string | null; email: string }[] | null) ?? []).filter((t) => t.email);
  if (list.length === 0) {
    return NextResponse.json({ error: "この企業には、メールを送れる事業者担当者が登録されていません。" }, { status: 400 });
  }
  if (body.preview === true) return NextResponse.json({ names: list.map((t) => t.name || "(氏名未登録)") });
  if (!mailConfigured()) {
    return NextResponse.json({ error: "メールの設定がありません。Vercel の環境変数に RESEND_API_KEY と SENDER_EMAIL を設定してください。" }, { status: 500 });
  }

  const { data: iv } = await supabase
    .from("hm_interviews")
    .select("id, companies(name)")
    .eq("id", interviewId)
    .maybeSingle();
  const { data: op } = await supabase.from("hm_interview_opinions").select("interview_date").eq("interview_id", interviewId).maybeSingle();
  const companyName = ((iv as { companies?: { name?: string } | null } | null)?.companies?.name ?? "").trim();
  const date = (op?.interview_date as string | null) ?? null;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || new URL(req.url).origin;

  const text = [
    `${companyName ? `${companyName} ` : ""}事業者ご担当者さま`,
    "",
    "従業員の方の産業医面談が終わり、産業医の意見書(就業上の措置に関する意見)が発行されました。",
    "詳細は、健康管理Webにログインしてご確認ください。",
    "",
    ...(date ? [`面談日: ${date.replace(/-/g, "/")}`] : []),
    `${origin}/interviews/${interviewId}`,
    "",
    "※このメールには、対象の方の氏名や健康に関する情報は記載していません。",
    "※意見書の内容は、就業上の措置を講じる目的以外に使わないでください。",
    "",
    "うえまつ産業医事務所",
  ].join("\n");

  let sent = 0;
  const failed: string[] = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) await sleep(600); // 1秒に2通までの制限に合わせる
    const r = await sendMail(list[i].email, "【健康管理Web】産業医面談の意見書が発行されました", text);
    if (r.ok) sent++;
    else failed.push(list[i].name || "(氏名未登録)");
  }
  if (sent > 0) await supabase.rpc("hm_mark_opinion_reported", { p_interview_id: interviewId, p_count: sent });
  return NextResponse.json({ sent, failed });
}
