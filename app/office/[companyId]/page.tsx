import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import InterviewsTable from "@/components/InterviewsTable";
import CompanyInfoForm from "@/components/CompanyInfoForm";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OfficeCompanyPage({
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

  const [{ data: minutes }, { data: interviews }, { data: companyInfo }] = await Promise.all([
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, physician_attended, published_to_employees")
      .eq("company_id", company.id)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_interviews")
      .select("id, target_name, interview_type, scheduled_at, method, status")
      .eq("company_id", company.id)
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("hm_company_info")
      .select("address, tel")
      .eq("company_id", company.id)
      .maybeSingle(),
  ]);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/office">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">{company.name}</h1>

        <div className="card">
          <h2>安全衛生委員会 議事録</h2>
          <p>
            <Link className="btn orange" href={`/office/${company.id}/minutes/new`}>
              ＋ 議事録を作成
            </Link>
          </p>
          <MinutesTable minutes={minutes ?? []} />
        </div>

        <div className="card">
          <h2>面談</h2>
          <p>
            <Link className="btn orange" href={`/office/${company.id}/interviews/new`}>
              ＋ 面談予定を登録
            </Link>
          </p>
          <InterviewsTable interviews={interviews ?? []} />
        </div>

        <div className="card">
          <h2>従業員カルテ</h2>
          <p>
            <Link className="btn" href={`/office/${company.id}/persons`}>
              カルテ一覧へ（書類共有・文書作成・履歴）
            </Link>
          </p>
        </div>

        <div className="card">
          <h2>健康診断</h2>
          <p>
            <Link className="btn" href={`/office/${company.id}/checkups`}>
              健診結果の管理へ（取込・有所見・就業判定・事後措置）
            </Link>
          </p>
        </div>

        <div className="card">
          <h2>企業情報</h2>
          <CompanyInfoForm
            companyId={company.id}
            initial={{
              address: companyInfo?.address ?? "",
              tel: companyInfo?.tel ?? "",
            }}
          />
        </div>

        <div className="card">
          <h2>ストレスチェック</h2>
          <p>
            <Link className="btn" href={`/office/${company.id}/stress`}>
              高ストレス者一覧・集団サマリーへ
            </Link>
          </p>
          <p className="muted">
            既存ストレスチェックWebのデータを読み取り専用で参照します。個人統合ビューは高ストレス者一覧・健診個人票から開けます。
          </p>
        </div>
      </main>
    </>
  );
}
