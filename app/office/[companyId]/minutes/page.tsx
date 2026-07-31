import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
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
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", params.companyId)
    .single();
  if (!company) notFound();

  const { data: minutes } = await supabase
    .from("hm_minutes")
    .select("id, meeting_date, title, physician_attended, published_to_employees")
    .eq("company_id", company.id)
    .order("meeting_date", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={`/office/${company.id}`}>← {company.name}</Link>
        </p>
        <h1 className="page-title">{company.name} — 安全衛生委員会議事録</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href={`/office/${company.id}/minutes/new`}>
              ＋ 議事録を作成
            </Link>
          </p>
          <MinutesTable minutes={minutes ?? []} />
        </div>
      </main>
    </>
  );
}
