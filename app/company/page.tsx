import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import CompanyInfoForm from "@/components/CompanyInfoForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateJa } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "/company/minutes", title: "安全衛生委員会議事録", desc: "議事録の作成・共有・印刷" },
  { href: "/company/patrols", title: "産業医巡視記録", desc: "職場巡視の記録の閲覧" },
  { href: "/company/interviews", title: "産業医面談管理", desc: "面談予定・日程調整・意見書" },
  { href: "/company/checkups", title: "健康診断", desc: "取込・有所見・事後措置" },
  { href: "/company/persons", title: "個人カルテ", desc: "診断書等の共有・履歴" },
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
    { count: followupPending },
    { data: companyInfo },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", profile.company_id).single(),
    supabase
      .from("hm_checkups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .eq("followup_status", "pending"),
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

        {(followupPending ?? 0) > 0 && (
          <div className="notice">
            健診の事後措置が未対応の方が <strong>{followupPending}名</strong> います。
            健康診断のページからご確認ください。
          </div>
        )}

        <div className="card-grid" style={{ marginTop: 18 }}>
          {MENU.map((m) => (
            <Link key={m.href} href={m.href} className="card" style={{ marginBottom: 0 }}>
              <strong style={{ color: "var(--teal-dark)" }}>{m.title}</strong>
              <div className="muted">{m.desc}</div>
            </Link>
          ))}
        </div>

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
