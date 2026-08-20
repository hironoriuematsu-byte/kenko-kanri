import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CompanyInfoForm from "@/components/CompanyInfoForm";
import MenuGrid from "@/components/MenuGrid";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "/company/minutes", title: "衛生委員会議事録", icon: "📋", desc: "議事録の作成・共有・年度まとめ印刷" },
  { href: "/company/hygiene-patrols", title: "衛生管理者巡視記録", icon: "✅", desc: "チェックリスト形式の職場巡視記録" },
  { href: "/company/patrols", title: "産業医巡視記録", icon: "🔍", desc: "産業医による職場巡視・写真の記録" },
  { href: "/company/env-measurements", title: "作業環境測定", icon: "📊", desc: "測定結果報告書のファイル保管・共有" },
  { href: "/company/interviews", title: "産業医面談管理", icon: "💬", desc: "面談予定・日程調整・意見書" },
  { href: "/company/checkups", title: "健康診断管理", icon: "🩺", desc: "取込・有所見・事後措置" },
  { href: "/company/persons", title: "個人カルテ", icon: "🗂️", desc: "診断書等の共有・履歴" },
];

export default async function CompanyDashboard() {
  const { profile } = await requireProfile();
  if (profile.role !== "company") redirect("/");
  if (!profile.company_id) {
    return (
      <>
        <Header profile={profile} />
        <main className="container">
          <div className="notice">
            所属企業が設定されていません。産業医事務所にお問い合わせください。
          </div>
        </main>
      </>
    );
  }

  const supabase = createClient();
  const [
    { data: company },
    { count: restrictedCount },
    { count: attentionCount },
    { data: companyInfo },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    supabase
      .from("hm_checkups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .in("work_judgment", ["restricted", "leave"]),
    supabase
      .from("hm_checkups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .eq("work_judgment", "pending"),
    supabase
      .from("hm_company_info")
      .select("address, tel")
      .eq("company_id", profile.company_id)
      .maybeSingle(),
  ]);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title" style={{ marginBottom: 4 }}>
          {company?.name ?? "自社"} ダッシュボード{" "}
          {companyInfo?.address && (
            <span style={{ fontSize: 14, color: "var(--muted)" }}>{companyInfo.address}</span>
          )}
        </h1>

        {((restrictedCount ?? 0) > 0 || (attentionCount ?? 0) > 0) && (
          <div className="notice">
            <strong>健康診断の就業判定について</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
              {(restrictedCount ?? 0) > 0 && (
                <li>
                  就業制限・要休業の判定を受けた方が <strong>{restrictedCount}名</strong> います。
                  健康診断管理の「医師の意見」欄をご確認のうえ、就業上の措置をご検討ください。
                </li>
              )}
              {(attentionCount ?? 0) > 0 && (
                <li>
                  産業医が「判定保留」とした方が <strong>{attentionCount}名</strong> います。
                  追加の情報提供や産業医面談の調整が必要な場合があります。
                </li>
              )}
            </ul>
          </div>
        )}

        <MenuGrid items={MENU} />

        <div className="card" style={{ marginTop: 18 }}>
          <h2>企業情報</h2>
          <CompanyInfoForm
            companyId={profile.company_id}
            initial={{
              address: companyInfo?.address ?? "",
              tel: companyInfo?.tel ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
