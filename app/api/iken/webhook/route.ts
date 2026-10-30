import { NextResponse } from "next/server";
import { constructWebhookEvent, STRIPE_APP } from "@/lib/stripe";
import { adminClient, officeEmails } from "@/lib/admin";
import { sendMails } from "@/lib/mail";
import { formatYen, SERVICE_NAME } from "@/lib/iken";
import { DOCTOR, SELLER } from "@/lib/org";

export const runtime = "nodejs";
export const maxDuration = 60;

type OrderRow = {
  id: string;
  kind: "new" | "add";
  status: string;
  company_id: string;
  fiscal_year: number;
  seats: number;
  seats_granted: number;
  amount: number;
  company_name: string;
  contact_name: string;
  contact_email: string;
};

// Stripe からの支払い通知(Webhook)。署名を確かめてから、事業場のその年度の件数枠を加え、担当者と実施者に知らせる。
// 同じ Stripe アカウントのストレスチェックWebの決済も届くため、metadata.app が "kenko-iken" のものだけを扱う。
// Stripe は同じ通知を再送することがあるため、件数枠は二重に加えない(hm_iken_provision_order)
export async function POST(req: Request) {
  const payload = await req.text();
  const event = constructWebhookEvent(payload, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET ?? "");
  if (!event) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded" &&
    event.type !== "checkout.session.async_payment_failed" &&
    event.type !== "checkout.session.expired"
  ) {
    return NextResponse.json({ ignored: true });
  }
  const session = event.data.object;
  if (session.metadata?.app !== STRIPE_APP) return NextResponse.json({ ignored: true }); // ストレスチェックWebの決済
  const orderId = session.metadata?.order_id;
  if (!orderId) return NextResponse.json({ ignored: true });

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await admin
      .from("hm_iken_orders")
      .update({ status: "expired", error: event.type === "checkout.session.expired" ? null : "期限までにお支払いが確認できませんでした" })
      .eq("id", orderId)
      .eq("status", "pending");
    return NextResponse.json({ ok: true });
  }
  if (session.payment_status !== "paid") return NextResponse.json({ waiting: true });

  const { data: order } = await admin.from("hm_iken_orders").select("*").eq("id", orderId).maybeSingle<OrderRow>();
  if (!order) return NextResponse.json({ ignored: true, reason: "order not found" }); // 再送させない

  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const { data: rows, error } = await admin.rpc("hm_iken_provision_order", { p_order: order.id, p_payment_intent: paymentIntent });
  const office = await officeEmails(admin);
  const summary = [
    `会社名: ${order.company_name}`,
    `ご担当者: ${order.contact_name} 様 (${order.contact_email})`,
    `年度: ${order.fiscal_year}年度`,
    order.kind === "new"
      ? `件数: ${order.seats_granted}件まで(お申込み ${order.seats}件)`
      : `追加件数: ${order.seats}件`,
    `お支払い金額: ${formatYen(order.amount)}(税込)`,
  ].join("\n");
  if (error || !rows?.[0]) {
    const msg = error?.message ?? "開設処理の結果がありません";
    await admin.from("hm_iken_orders").update({ status: "failed", error: msg }).eq("id", order.id);
    await sendMails(office, `【${SERVICE_NAME}】支払い後の処理に失敗しました(要確認)`, `${summary}\n\nエラー: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 }); // Stripe に再送してもらう
  }
  const { seats: totalSeats, already } = rows[0] as { seats: number; already: boolean };
  const invoiceId = typeof session.invoice === "string" ? session.invoice : (session.invoice?.id ?? null);
  if (invoiceId) await admin.from("hm_iken_orders").update({ stripe_invoice_id: invoiceId }).eq("id", order.id);
  if (already) return NextResponse.json({ ok: true, already: true });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  await sendMails(
    [order.contact_email],
    order.kind === "new"
      ? `【${SERVICE_NAME}】${order.fiscal_year}年度のお申込みありがとうございます`
      : `【${SERVICE_NAME}】件数を追加しました`,
    [
      order.company_name,
      `${order.contact_name} 様`,
      "",
      order.kind === "new"
        ? `${order.fiscal_year}年度のお申込みを承りました。お支払いを確認し、健診結果を送っていただける状態になりました。`
        : "件数の追加を承りました。",
      "",
      summary,
      `${order.fiscal_year}年度の件数枠: 合計 ${totalSeats}件`,
      "",
      "■ 健診結果の送り方",
      "健康管理Webにログインし、「健康診断管理」→「健診結果を送る」から、健診機関のCSVまたはPDFをそのまま送ってください。",
      "受け付けた日から3営業日以内に、産業医が就業判定と意見を入力してメールでお知らせします。",
      "",
      "■ 領収書",
      "決済代行会社(Stripe)から領収書のメールが届きます。ログイン後の「医師意見聴取のお申込み」からも、いつでもダウンロードできます。",
      "",
      `${origin}/company/iken`,
      `意見を述べる医師: ${DOCTOR.full}(${DOCTOR.officeName})`,
      `お問い合わせ: ${SELLER.email}`,
    ].join("\n")
  );
  await sendMails(
    office,
    order.kind === "new"
      ? `【${SERVICE_NAME}】Web申込(${order.fiscal_year}年度)がありました`
      : `【${SERVICE_NAME}】件数の追加購入がありました`,
    `${summary}\n${order.fiscal_year}年度の件数枠: 合計 ${totalSeats}件\n\n${origin}/office`
  );
  return NextResponse.json({ ok: true });
}
