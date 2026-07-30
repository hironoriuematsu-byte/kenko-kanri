import Header from "@/components/Header";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UnavailablePage() {
  const { profile } = await requireProfile();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <div className="card">
          <h2>このアカウントではご利用いただけません</h2>
          <p>
            実施事務従事者（jimu）アカウントは、健康管理Webの対象外です。
            ストレスチェック関連の業務は従来どおりストレスチェックWebをご利用ください。
          </p>
          <p className="muted">
            健康管理Webのご利用が必要な場合は、産業医事務所までお問い合わせください。
          </p>
        </div>
      </main>
    </>
  );
}
