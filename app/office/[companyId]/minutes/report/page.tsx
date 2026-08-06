import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PrintButton from "@/components/PrintButton";
import MinutesSheet from "@/components/MinutesSheet";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fiscalYearOf } from "@/lib/minutesYears";
import { getFiscalYear } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

// 年度内の議事録をまとめて表示・印刷/PDF
export default async function OfficeMinutesReportPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { year?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const year = searchParams.year ? Number(searchParams.year) : getFiscalYear();
  const supabase = createClient();
  const [{ data: company }, { data: allMinutes }] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", params.companyId).single(),
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, attendees, agenda")
      .eq("company_id", params.companyId)
      .order("meeting_date", { ascending: true }),
  ]);
  if (!company) notFound();

  const minutes = (allMinutes ?? []).filter((m) => fiscalYearOf(m.meeting_date) === year);

  await supabase.rpc("hm_log_access", {
    p_action: "print_batch",
    p_target_table: "hm_minutes",
    p_target_id: null,
    p_detail: { company_id: company.id, fiscal_year: year, count: minutes.length },
  });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <div
          className="no-print"
          style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}
        >
          <Link className="muted" href={`/office/${company.id}/minutes?year=${year}`}>
            ← 一覧に戻る
          </Link>
          <PrintButton />
          <span className="muted">
            {year}年度の議事録 {minutes.length}件を表示しています。
          </span>
        </div>

        {minutes.length === 0 ? (
          <div className="card">
            <p className="muted">{year}年度の議事録はありません。</p>
          </div>
        ) : (
          minutes.map((m) => (
            <div className="card sheet-break" key={m.id}>
              <MinutesSheet minutes={m} companyName={company.name} />
            </div>
          ))
        )}
      </main>
    </>
  );
}
