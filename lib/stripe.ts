import Stripe from "stripe";
import { SELLER, registrationNo } from "@/lib/org";
import { taxIncluded } from "@/lib/iken";

// ============================================================
// Stripe(健診結果の医師意見聴取Webの決済)。ストレスチェックWebと同じ Stripe アカウントを使う。
// カード番号は Stripe の決済画面(Checkout)で入力され、このシステムのサーバーには届かない。
//
// 環境変数(Vercel の kenko-kanri プロジェクト。値は「Sensitive」に):
//   STRIPE_SECRET_KEY     … ストレスチェックWebと同じキーでよい(制限付きキー: Checkout Sessions 書き込み / Invoices 読み取り)
//   STRIPE_WEBHOOK_SECRET … このアプリ用に作った Webhook エンドポイント(https://kenko.mestate.jp/api/iken/webhook)の署名シークレット
//   STRIPE_AUTOMATIC_TAX  … "1" のときだけ Stripe Tax で消費税を計算する
//
// 同じ Stripe アカウントの Webhook はストレスチェックWebにも届くため、この決済には metadata.app = "kenko-iken" を付け、
// 互いに相手の決済を無視する(ストレスチェックWeb側も app を見て無視する)
// ============================================================

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;
export const STRIPE_APP = "kenko-iken";
const INTEGRATION_ID = "kenko-iken-web-plan";

export const stripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

let client: Stripe | null = null;
export function stripeClient(): Stripe {
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      appInfo: { name: "kenko-iken-web" },
    });
  }
  return client;
}

// 領収書(請求書PDF)を適格請求書の記載事項を満たす形にする
export function invoiceFields(companyName: string, total: number): { customFields: { name: string; value: string }[]; footer: string } {
  const reg = registrationNo();
  const tax = taxIncluded(total);
  return {
    customFields: [
      { name: "宛名", value: `${companyName} 御中`.slice(0, 140) },
      ...(reg ? [{ name: "登録番号", value: reg }] : []),
      { name: "適用税率", value: `10%(10%対象 ${total.toLocaleString()}円 うち消費税 ${tax.toLocaleString()}円)` },
    ],
    footer: [`${SELLER.issuerName} ${SELLER.address}`, reg ? `登録番号 ${reg}` : null, reg ? "本書は適格請求書を兼ねます" : null]
      .filter(Boolean)
      .join(" / "),
  };
}

export async function createCheckoutSession(opts: {
  orderId: string;
  email: string;
  companyName: string;
  total: number;
  lines: { name: string; unitAmount: number; quantity: number }[];
  successUrl: string;
  cancelUrl: string;
  description: string;
}): Promise<{ id: string; url: string }> {
  const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === "1";
  const inv = invoiceFields(opts.companyName, opts.total);
  const params: Stripe.Checkout.SessionCreateParams & { integration_identifier?: string } = {
    mode: "payment",
    locale: "ja",
    customer_email: opts.email,
    customer_creation: "always",
    client_reference_id: opts.orderId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    line_items: opts.lines.map((l) => ({
      quantity: l.quantity,
      price_data: { currency: "jpy", unit_amount: l.unitAmount, tax_behavior: "inclusive", product_data: { name: l.name } },
    })),
    automatic_tax: automaticTax ? { enabled: true } : undefined,
    metadata: { order_id: opts.orderId, app: STRIPE_APP },
    payment_intent_data: { metadata: { order_id: opts.orderId, app: STRIPE_APP } },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: opts.description,
        footer: inv.footer,
        custom_fields: inv.customFields.slice(0, 4),
        metadata: { order_id: opts.orderId, app: STRIPE_APP },
      },
    },
    integration_identifier: INTEGRATION_ID,
  };
  const session = await stripeClient().checkout.sessions.create(params, { idempotencyKey: `iken-checkout-${opts.orderId}` });
  if (!session.url) throw new Error("Stripe: 決済画面のURLがありません");
  return { id: session.id, url: session.url };
}

export async function receiptPageUrl(opts: { invoiceId?: string | null; sessionId?: string | null }): Promise<string | null> {
  const stripe = stripeClient();
  let invoiceId = opts.invoiceId ?? null;
  if (!invoiceId && opts.sessionId) {
    const s = await stripe.checkout.sessions.retrieve(opts.sessionId);
    invoiceId = typeof s.invoice === "string" ? s.invoice : (s.invoice?.id ?? null);
  }
  if (!invoiceId) return null;
  const inv = await stripe.invoices.retrieve(invoiceId);
  return inv.hosted_invoice_url ?? null;
}

export function constructWebhookEvent(payload: string, header: string | null, secret: string): Stripe.Event | null {
  if (!header || !secret) return null;
  try {
    return Stripe.webhooks.constructEvent(payload, header, secret);
  } catch {
    return null;
  }
}
