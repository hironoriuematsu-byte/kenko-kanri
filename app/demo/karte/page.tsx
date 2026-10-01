import Link from "next/link";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../DemoNotice";
import { DEMO_COMPANY, DEMO_KARTE } from "@/lib/demo-data";
import { CHECKUP_TYPES, CHECKUP_WORK_JUDGMENTS } from "@/lib/checkups";
import { DOC_TYPES, FILE_CATEGORIES, VISIBILITY_LABELS } from "@/lib/karte";
import { INTERVIEW_STATUS, INTERVIEW_TYPES, formatDateTimeJa } from "@/lib/interviews";
import { formatDateJa } from "@/lib/fiscal";

export const metadata = { title: "個人カルテ(デモ) | 健康管理Web" };

// 紹介用デモ: 従業員カルテ(基本情報+書類+産業医文書+健診/面談履歴)
export default function DemoKartePage() {
  const p = DEMO_KARTE;
  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted">
          <Link href="/demo">← デモの目次</Link>
        </p>
        <h1 className="page-title">
          {DEMO_COMPANY} — カルテ: {p.full_name}
        </h1>
        <DemoNotice />

        <div className="card">
          <h2>基本情報</h2>
          <table className="list">
            <tbody>
              <tr>
                <th style={{ width: 130 }}>氏名</th>
                <td>
                  {p.full_name}
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{p.kana}</span>
                </td>
                <th style={{ width: 130 }}>社員番号</th>
                <td>{p.employee_no}</td>
              </tr>
              <tr>
                <th>生年月日</th>
                <td>{formatDateJa(p.birth_date)}</td>
                <th>部署</th>
                <td>{p.department}</td>
              </tr>
              <tr>
                <th>備考</th>
                <td colSpan={3}>{p.note}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>健康診断の履歴</h2>
          <table className="list">
            <thead>
              <tr>
                <th>年度</th>
                <th>種別</th>
                <th>健診日</th>
                <th>総合判定</th>
                <th>就業判定</th>
              </tr>
            </thead>
            <tbody>
              {p.checkups.map((c) => (
                <tr key={c.fiscal_year}>
                  <td>{c.fiscal_year}年度</td>
                  <td>{CHECKUP_TYPES[c.checkup_type]}</td>
                  <td>{formatDateJa(c.checkup_date)}</td>
                  <td style={c.overall_judgment === "D" ? { color: "var(--danger)", fontWeight: 700 } : {}}>{c.overall_judgment}</td>
                  <td>{CHECKUP_WORK_JUDGMENTS[c.work_judgment]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            実際の画面では、年度を押すと検査値の一覧と経年推移が開きます。
          </p>
        </div>

        <div className="card">
          <h2>産業医面談の履歴</h2>
          <table className="list">
            <thead>
              <tr>
                <th>面談日</th>
                <th>種別</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {p.interviews.map((i) => (
                <tr key={i.id}>
                  <td>{i.id === "i1" ? <Link href={`/demo/interviews/${i.id}`}>{formatDateTimeJa(i.scheduled_at)}</Link> : formatDateTimeJa(i.scheduled_at)}</td>
                  <td>{INTERVIEW_TYPES[i.interview_type]}</td>
                  <td>
                    <span className="badge orange">{INTERVIEW_STATUS[i.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>産業医作成文書</h2>
          <table className="list">
            <thead>
              <tr>
                <th>種類</th>
                <th>宛先</th>
                <th>発行日</th>
                <th>共有範囲</th>
              </tr>
            </thead>
            <tbody>
              {p.documents.map((d) => (
                <tr key={d.title}>
                  <td>{DOC_TYPES[d.doc_type] ?? d.title}</td>
                  <td>{d.addressee}</td>
                  <td>{formatDateJa(d.issued_date)}</td>
                  <td>{VISIBILITY_LABELS[d.visibility] ?? d.visibility}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            診療情報提供依頼書などを定型文から作成し、印刷・PDF保存できます。「産業医事務所のみ」の文書は企業には表示されません。
          </p>
        </div>

        <div className="card">
          <h2>書類（診断書・診療情報提供書など）</h2>
          <table className="list">
            <thead>
              <tr>
                <th>区分</th>
                <th>ファイル</th>
                <th>メモ</th>
                <th>共有範囲</th>
                <th>登録日</th>
              </tr>
            </thead>
            <tbody>
              {p.files.map((f) => (
                <tr key={f.file_name}>
                  <td>{FILE_CATEGORIES[f.category] ?? f.category}</td>
                  <td>{f.file_name}</td>
                  <td>{f.note}</td>
                  <td>{VISIBILITY_LABELS[f.visibility] ?? f.visibility}</td>
                  <td>{formatDateJa(f.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            ファイルは非公開の保存領域に置かれ、開くたびにアクセスログに記録されます(デモではダウンロードできません)。
          </p>
        </div>
      </main>
    </>
  );
}
