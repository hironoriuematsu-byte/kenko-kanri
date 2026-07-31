import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import MinutesSettingsForm from "@/components/MinutesSettingsForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeMinutesPage({
  params,
}: {
  params: { companyId: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const supabase = createClient();
  const [{ data: company }, { data: minutes }, { data: info }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, published_to_employees")
      .eq("company_id", params.companyId)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_company_info")
      .select("committee_name, default_attendees")
      .eq("company_id", params.companyId)
      .maybeSingle(),
  ]);
  if (!company) notFound();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">
          {company.name} — {info?.committee_name ?? "安全衛生委員会"}議事録
        </h1>
        <div className="card">
          <p>
            <Link className="btn orange" href={`/office/${company.id}/minutes/new`}>
              ＋ 議事録を作成
            </Link>
          </p>
          <MinutesTable minutes={minutes ?? []} />
        </div>

        <div className="card">
          <h2>議事録の設定</h2>
          <MinutesSettingsForm
            companyId={company.id}
            initial={{
              committee_name: info?.committee_name ?? "",
              default_attendees: info?.default_attendees ?? "",
            }}
          />
        </div>
      </main>
    </>
  );
}
