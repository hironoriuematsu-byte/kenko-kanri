import { NextResponse } from "next/server";
import { checkEmailDomain } from "@/lib/email-domain-check";
import { officeKey, parseSignupInput, SERVICE_NAME } from "@/lib/iken";
import { adminClient, officeEmails } from "@/lib/admin";
import { sendMails } from "@/lib/mail";
import { DOCTOR, SELLER } from "@/lib/org";
import { stripeConfigured } from "@/lib/stripe";
import { jstDateOf } from "@/lib/businessDays";

export const runtime = "nodejs";
export const maxDuration = 60;

// 健診結果の医師意見聴取Web: 会社(事業場)の登録。お支払いはログイン後の画面で年度ごとに行う。
//   - 企業台帳(companies)はストレスチェックWebと共用。健康管理Webを使えるようにする(hm_enabled = true)
//   - 担当者は事業者担当者(company)のアカウント。確認メールのリンクを開くと健康管理Webの担当者の画面へ進む
//   - 同じ事業場(登録番号または法人番号 + 事業場名)・同じメールアドレスの二重登録は止めてログインへ案内する
export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "現在、Web申込は準備中です。お手数ですがメールでお問い合わせください。" }, { status: 503 });
  }
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY が未設定です" }, { status: 500 });

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const parsed = parseSignupInput(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const domain = await checkEmailDomain(v.contactEmail);
  if (!domain.ok) return NextResponse.json({ error: domain.message }, { status: 400 });

  const key = officeKey(v.officeName);
  const office = await officeEmails(admin);
  const alreadyMsg =
    "この事業場はすでに登録されています。ご担当者さまがログインして、ログイン後の画面からお申し込みください。" +
    `ご担当者さまが分からない・変わった場合は ${SELLER.email} までご連絡ください。`;

  if (v.bizId) {
    const { data: same } = await admin
      .from("hm_iken_companies")
      .select("company_id")
      .eq("biz_id", v.bizId)
      .eq("office_key", key)
      .limit(1);
    if (same && same.length > 0) {
      await sendMails(
        office,
        `【${SERVICE_NAME}】登録済みの事業場から、もう一度会社登録がありました`,
        `会社名: ${v.companyName} ${v.officeName}\n担当者: ${v.contactName} (${v.contactEmail} / ${v.contactPhone})\n\n` +
          "登録はせず、ご担当者のログインへ案内しました。担当者の交代などの可能性があるので、必要ならご連絡ください。"
      );
      return NextResponse.json({ error: alreadyMsg, exists: true }, { status: 409 });
    }
  }

  // いたずらの大量登録を防ぐ(全体で10分間に10件まで)
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recent } = await admin
    .from("hm_iken_companies")
    .select("company_id", { count: "exact", head: true })
    .gte("created_at", since);
  if ((recent ?? 0) >= 10) {
    return NextResponse.json({ error: "ただいま登録が混み合っています。10分ほどおいてからもう一度お試しください。" }, { status: 429 });
  }

  // 企業を作る(企業コード: K + 登録日 + 英数字3文字)。台帳の表示名は「会社名 事業場名」
  const day = jstDateOf(new Date()).replace(/-/g, "").slice(2);
  const displayName = v.officeName && v.officeName !== v.companyName ? `${v.companyName} ${v.officeName}` : v.companyName;
  let company: { id: string; code: string } | null = null;
  for (let i = 0; i < 5 && !company; i++) {
    const code = `K${day}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const { data, error } = await admin
      .from("companies")
      .insert({ name: displayName, code, hm_enabled: true })
      .select("id, code")
      .single();
    if (data) company = data;
    else if (error?.code !== "23505") {
      return NextResponse.json({ error: `登録できませんでした: ${error?.message ?? ""}` }, { status: 500 });
    }
  }
  if (!company) return NextResponse.json({ error: "登録できませんでした。もう一度お試しください。" }, { status: 500 });
  const removeCompany = () => admin.from("companies").delete().eq("id", company!.id);

  const { error: icErr } = await admin.from("hm_iken_companies").insert({
    company_id: company.id,
    biz_id: v.bizId,
    office_name: v.officeName,
    office_key: key,
    address: v.address,
    workers: v.workers,
    work_info: v.workInfo,
    contact_name: v.contactName,
    contact_email: v.contactEmail,
    contact_phone: v.contactPhone,
  });
  if (icErr) {
    await removeCompany();
    if (icErr.code === "23505") return NextResponse.json({ error: alreadyMsg, exists: true }, { status: 409 });
    return NextResponse.json({ error: `登録できませんでした: ${icErr.message}` }, { status: 500 });
  }

  // 担当者のアカウント。確認用のリンクだけを発行し(Supabase からはメールを送らない)、メールはこちらから送る
  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || new URL(req.url).origin;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "signup",
    email: v.contactEmail,
    password: v.password,
    options: { data: { full_name: v.contactName } },
  });
  const existsMsg =
    "このメールアドレスはすでに登録されています。別のメールアドレスで登録するか、ログインしてください(ストレスチェックWebをご利用中の方は、" +
    `同じ会社であれば ${SELLER.email} までご連絡ください。同じアカウントで使えるようにします)。`;
  if (linkErr || !link?.user || !link.properties?.hashed_token) {
    await removeCompany();
    const exists = linkErr && (linkErr.code === "email_exists" || /already been registered|already exists/i.test(linkErr.message));
    if (exists) return NextResponse.json({ error: existsMsg, exists: true }, { status: 409 });
    return NextResponse.json({ error: `登録できませんでした: ${linkErr?.message ?? ""}` }, { status: 400 });
  }

  // すでにプロフィールのあるアカウント(ストレスチェックWebの従業員・担当者など)は付け替えない
  const { data: prof } = await admin.from("profiles").select("role, company_id").eq("user_id", link.user.id).maybeSingle();
  if (prof) {
    await removeCompany();
    return NextResponse.json({ error: existsMsg, exists: true }, { status: 409 });
  }
  const { error: profErr } = await admin.from("profiles").upsert({
    user_id: link.user.id,
    role: "company",
    name: v.contactName,
    emp_id: null,
    dept: null,
    company_id: company.id,
  });
  if (profErr) {
    return NextResponse.json({ error: `登録エラー: ${profErr.message}。${SELLER.email} までご連絡ください` }, { status: 500 });
  }

  // (企業の削除を妨げないよう、登録が確定してから入れる)事業場の住所・電話は帳票にも使う(健康管理Webの企業補足情報)
  await admin.from("hm_company_info").upsert({ company_id: company.id, address: v.address, tel: v.contactPhone });

  const confirmUrl =
    `${origin}/auth/callback?token_hash=${encodeURIComponent(link.properties.hashed_token)}` +
    `&type=${encodeURIComponent(link.properties.verification_type || "signup")}&next=${encodeURIComponent("/company")}`;
  await sendMails(
    [v.contactEmail],
    `【${SERVICE_NAME}】担当者アカウントの確認(会社登録)`,
    [
      displayName,
      `${v.contactName} 様`,
      "",
      `${SERVICE_NAME}に会社をご登録いただき、ありがとうございます。`,
      "下のリンクを開き、「アカウントを有効にして担当者の画面へ」を押してください。健康管理Webの担当者の画面が開きます。",
      "",
      confirmUrl,
      "",
      "■ このあとの流れ",
      "1. 担当者の画面で、その年度の健診結果の件数(人数)を入力して、お支払い(クレジットカード)",
      "2. 健診機関から届いた健診結果(CSVまたはPDF)を、健康管理Webからそのまま送信",
      "3. 産業医が就業判定と意見を入力し、3営業日以内にメールでお知らせします",
      "",
      "※ リンクの有効期限は、このメールが届いてから1時間です。期限が切れた場合はお問い合わせください。",
      "※ このメールに心当たりがない場合は、破棄してください。",
      "",
      `意見を述べる医師: ${DOCTOR.full}(${DOCTOR.officeName})`,
      `お問い合わせ: ${SELLER.email}`,
    ].join("\n")
  );

  await sendMails(
    office,
    `【${SERVICE_NAME}】Web申込の会社登録がありました`,
    `会社名: ${displayName}\n企業コード: ${company.code}\n番号: ${v.bizId ?? "(なし)"}\n所在地: ${v.address}\n` +
      `労働者数: ${v.workers}名\n業務内容: ${v.workInfo}\n担当者: ${v.contactName} (${v.contactEmail} / ${v.contactPhone})\n\n` +
      "お支払いは、担当者がログイン後の画面で年度ごとに行います。"
  );
  return NextResponse.json({ ok: true });
}
