import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import JudgmentRulesEditor from "@/components/JudgmentRulesEditor";
import { requireProfile } from "@/lib/auth";
import { getJudgmentRules } from "@/lib/judgmentRules";

export const dynamic = "force-dynamic";

// 事務所の自動判定基準(A〜D)の設定
export default async function JudgmentCriteriaPage() {
  const { profile } = await requireProfile();
  if (profile.role !== "office") redirect("/");

  const rules = await getJudgmentRules();

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href="/office">← ダッシュボード</Link>
        </p>
        <h1 className="page-title">健診結果の判定基準（事務所基準）</h1>

        <div className="notice">
          初期値は日本人間ドック予防医療協会の判定区分に沿って登録していますが、
          <strong>運用開始前に必ず最新の判定区分表と照合し、必要に応じて修正してください</strong>。
          判定は A（異常なし）／B（軽度異常）／C（要再検査・生活改善）／D（要精検・治療）の4区分で、
          E（治療中）は自動判定しません。対象は労働安全衛生法に基づく定期健康診断の法定検査項目のみです。
          どのルールにも当てはまらない値は A と判定されます。
        </div>

        <div className="card">
          <h2>判定ルール</h2>
          <p className="muted">
            数値項目は「下限（以上）」「上限（以下）」で範囲を指定します（空欄は制限なし）。
            尿糖・尿蛋白などの定性検査は「定性一致」に ± や + を入力してください。
            1つの項目で複数のルールに該当した場合、および複数の項目に異常があった場合は、
            最も重い判定が総合判定になります。
          </p>
          <JudgmentRulesEditor initial={rules} />
        </div>
      </main>
    </>
  );
}
