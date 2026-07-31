import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyMinutesPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: minutes } = await supabase
    .from("hm_minutes")
    .select("id, meeting_date, title, physician_attended, published_to_employees")
    .eq("company_id", profile.company_id)
    .order("meeting_date", { ascending: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">安全衛生委員会議事録</h1>
        <div className="card">
          <p>
            <Link className="btn orange" href="/company/minutes/new">
              ＋ 議事録を作成
            </Link>
          </p>
          <MinutesTable minutes={minutes ?? []} />
        </div>
      </main>
    </>
  );
}
