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
          日本人間ドック・予防医療学会「<strong>判定区分（2026年4月1日改定）</strong>」の数値を、
          労働安全衛生規則第44条の定期健康診断の法定検査項目に限って登録しています。
          判定は A（異常なし）／B（軽度異常）／C（要再検査・生活改善）／D（要精密検査・治療）の4区分で、
          E（治療中）は自動判定しません。どのルールにも当てはまらない値は A と判定され、
          複数の異常所見がある場合は最も重い判定が総合判定になります。
        </div>

        <div className="card">
          <h2>判定区分表との運用上の差異</h2>
          <ul style={{ paddingLeft: 20, margin: 0, fontSize: 14 }}>
            <li>
              <strong>血糖（FPG・HbA1c）</strong>: 判定区分表では両者の組み合わせで判定しますが、
              本システムはFPGとHbA1cを個別に判定し、重い方を採用します
              （片方のみ基準を超えた場合、表よりも重い判定になることがあります）。
            </li>
            <li>
              <strong>赤血球数</strong>: 判定区分表に区分の記載がないため、自動判定の対象外です
              （貧血の判定は血色素量で行います）。
            </li>
            <li>
              <strong>聴力</strong>: 表は「35dB」を軽度異常としていますが、本システムは31〜39dBをBとしています。
            </li>
            <li>
              <strong>尿蛋白</strong>: 「尿蛋白(＋)かつ尿潜血(＋)はD」という注記（＊10）は、
              尿潜血が法定項目外のため自動適用していません。
            </li>
            <li>
              胸部エックス線・心電図・既往歴・自覚症状などの画像・問診項目は自動判定の対象外です。
            </li>
          </ul>
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
