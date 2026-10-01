import Link from "next/link";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "./DemoNotice";
import { DEMO_COMPANY, DEMO_FISCAL_YEAR, DEMO_INTERVIEWS, demoCheckups } from "@/lib/demo-data";
import { isFindingJudgment } from "@/lib/checkups";

export const metadata = {
  title: "サンプル(デモ) | 健康管理Web",
  description: "架空企業のデータで、健康診断管理・産業医面談管理・個人カルテの画面をご覧いただけます。",
};

// 広告・紹介用のデモ。ログイン不要で、架空データのみを表示する(ストレスチェックWebのデモと同じ構成)
export default function DemoTopPage() {
  const { rows } = demoCheckups();
  const findings = rows.filter(
    (r) => r.has_findings || isFindingJudgment(r.overall_judgment) || (r.findingItems ?? []).some((it) => isFindingJudgment(it.judgment))
  ).length;
  const instructed = rows.filter((r) => (r.overall_judgment ?? "").startsWith("D")).length;
  const depts = Array.from(new Set(rows.map((r) => r.department ?? "")));

  const sections = [
    {
      href: "/demo/checkups",
      icon: "🩺",
      title: "健康診断管理",
      lead:
        "健診機関のCSVを取り込むと、受診者ごとの有所見項目(C)・要医療項目(D)・就業制限項目(R)が一覧になり、産業医がそのまま就業判定と医師の意見を入力します。受診勧奨の進み具合、要受診勧奨・要就業制限・要産業医面談での絞り込み、定期健康診断結果報告書(様式第6号)の転記用集計までを1画面で確認できます。",
      btn: "健康診断管理の画面を見る",
    },
    {
      href: "/demo/interviews",
      icon: "💬",
      title: "産業医面談管理",
      lead:
        "面談の予定、企業担当者が事前に共有する情報、産業医だけが見られる実施記録、企業にお渡しする意見書を1つの流れで管理します。意見書を公開すると面談は実施済になり、企業担当者は印刷用の意見書を開けます。",
      btn: "面談の一覧と意見書を見る",
    },
    {
      href: "/demo/karte",
      icon: "🗂️",
      title: "個人カルテ",
      lead:
        "従業員ごとに、健診の経年推移、面談の履歴、産業医が作成した文書(診療情報提供依頼書など)、診断書などの書類をまとめて確認できます。企業に見せる書類と産業医事務所だけで持つ書類を分けて保管します。",
      btn: "カルテのサンプルを見る",
    },
  ];

  return (
    <>
      <DemoHeader />
      <main className="container" style={{ maxWidth: 820 }}>
        <div className="card">
          <span className="badge orange">サンプル(デモ)</span>
          <h1 className="page-title" style={{ margin: "10px 0 8px" }}>健康管理Web 体験デモ</h1>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            産業医事務所が契約企業の<strong>健康診断の事後措置</strong>、<strong>産業医面談</strong>、
            <strong>従業員ごとのカルテ</strong>を管理する画面を、架空の企業「{DEMO_COMPANY}」
            ({DEMO_FISCAL_YEAR}年度・受診者{rows.length}名・{depts.length}部署)のデータでご覧いただけます。
            実際の画面と同じ部品で表示しており、産業医事務所と企業担当者のどちらにどこまで見えるかもそのままです。
          </p>
          <div className="notice" style={{ marginTop: 14 }}>
            このページのデータは<strong>すべて架空のもの</strong>です(実在の企業・個人とは一切関係ありません)。
            デモでは閲覧のみでき、登録・保存・ダウンロードはできません。
          </div>
        </div>

        <div className="card">
          <h2>{DEMO_COMPANY} の概要(架空)</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            {[
              ["受診者数", `${rows.length} 名`],
              ["有所見者数", `${findings} 名`],
              ["医師の指示人数", `${instructed} 名`],
              ["産業医面談", `${DEMO_INTERVIEWS.length} 件`],
            ].map(([k, v]) => (
              <div key={k} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 18px", textAlign: "center" }}>
                <div className="muted" style={{ fontSize: 11 }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--teal-dark)" }}>{v}</div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>部署: {depts.join(" / ")}</p>
        </div>

        {sections.map((s) => (
          <div className="card" key={s.href}>
            <h2>
              {s.icon} {s.title}
            </h2>
            <p style={{ margin: "0 0 12px", lineHeight: 1.9 }}>{s.lead}</p>
            <Link className="btn" href={s.href}>
              {s.btn}
            </Link>
          </div>
        ))}

        <div className="card">
          <h2>📈 ストレスチェックWebとの連携</h2>
          <p style={{ margin: "0 0 12px", lineHeight: 1.9 }}>
            ストレスチェックWebと同じアカウント・同じ企業台帳で動きます。高ストレス者の面接指導の申出は、
            そのまま健康管理Webの産業医面談として登録され、健診の結果とあわせて個人カルテに残ります。
          </p>
          {process.env.NEXT_PUBLIC_STRESS_URL && (
            <a className="btn secondary" href={`${process.env.NEXT_PUBLIC_STRESS_URL}/demo`} target="_blank" rel="noopener noreferrer">
              ストレスチェックWebのデモを見る ↗
            </a>
          )}
        </div>

        <div className="card">
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            導入のご相談・お見積りは、
            <a href="https://mestate.jp/" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, textDecoration: "underline" }}>
              うえまつ産業医事務所
            </a>
            までお問い合わせください。
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btn orange" href="https://mestate.jp/" target="_blank" rel="noopener noreferrer">
              うえまつ産業医事務所のサイトを見る
            </a>
            <Link className="btn secondary" href="/login">
              ログイン画面へ
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
