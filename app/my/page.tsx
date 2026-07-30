import { redirect } from "next/navigation";
import Header from "@/components/Header";
import MinutesTable from "@/components/MinutesTable";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "employee") redirect("/");

  const supabase = createClient();
  const { data: minutes } = await supabase
    .from("hm_minutes")
    .select("id, meeting_date, title, physician_attended, published_to_employees")
    .order("meeting_date", { ascending: false });

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
          <h2>今後追加予定の機能</h2>
          <p className="muted">
            ご自身の健康診断結果（経年表示）・面談予定の確認は次のフェーズで追加されます。
          </p>
        </div>
      </main>
    </>
  );
}
