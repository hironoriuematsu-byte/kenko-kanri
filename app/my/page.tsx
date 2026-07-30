import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import InterviewsTable from "@/components/InterviewsTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "employee") redirect("/");

  const supabase = createClient();
  const [{ data: minutes }, { data: interviews }] = await Promise.all([
    supabase
      .from("hm_minutes")
      .select("id, meeting_date, title, physician_attended, published_to_employees")
      .order("meeting_date", { ascending: false }),
    supabase
      .from("hm_interviews")
      .select("id, target_name, interview_type, scheduled_at, method, status")
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
  ]);

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <h1 className="page-title">マイページ</h1>

        <div className="card">
          <h2>公開された安全衛生委員会 議事録</h2>
          <MinutesTable minutes={minutes ?? []} />
        </div>

        <div className="card">
          <h2>ご自身の面談予定</h2>
          <InterviewsTable interviews={interviews ?? []} showTarget={false} />
        </div>

        <div className="card">
          <h2>今後追加予定の機能</h2>
          <p className="muted">
            ご自身の健康診断結果（経年表示）は次のフェーズで追加されます。
          </p>
        </div>
      </main>
    </>
  );
}
