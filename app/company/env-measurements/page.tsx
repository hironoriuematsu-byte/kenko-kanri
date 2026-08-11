import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import EnvMeasurementsPanel from "@/components/EnvMeasurementsPanel";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompanyEnvMeasurementsPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "company" || !profile.company_id) redirect("/");

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("hm_env_measurements")
    .select("id, measurement_date, title, note, file_name, storage_path, uploaded_by")
    .eq("company_id", profile.company_id)
    .order("measurement_date", { ascending: false, nullsFirst: false });

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/company">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">作業環境測定</h1>
        <div className="card">
          <EnvMeasurementsPanel
            companyId={profile.company_id}
            initialRows={(rows as any[]) ?? []}
            role="company"
            currentUserId={profile.id}
          />
        </div>
      </main>
    </>
  );
}
