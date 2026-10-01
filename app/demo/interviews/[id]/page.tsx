import Link from "next/link";
import { notFound } from "next/navigation";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../../DemoNotice";
import { DEMO_COMPANY, DEMO_PHYSICIAN, demoInterview } from "@/lib/demo-data";
import { INTERVIEW_METHODS, INTERVIEW_STATUS, INTERVIEW_TYPES, WORK_JUDGMENTS, formatDateTimeJa } from "@/lib/interviews";
import { formatDateJa } from "@/lib/fiscal";

export const metadata = { title: "面談詳細(デモ) | 健康管理Web" };

const ro: React.CSSProperties = { background: "#f7f9f9" };

// 紹介用デモ: 面談詳細(産業医事務所の画面。企業担当者には事前情報と公開済みの意見書だけが見える)
export default function DemoInterviewDetailPage({ params }: { params: { id: string } }) {
  const iv = demoInterview(params.id);
  if (!iv) notFound();

  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted">
          <Link href="/demo/interviews">← 面談一覧に戻る</Link>
        </p>
        <h1 className="page-title">
          面談: {iv.target_name}（{INTERVIEW_TYPES[iv.interview_type] ?? iv.interview_type}）
        </h1>
        <DemoNotice />

        <div className="card">
          <h2>予定</h2>
          <table className="list">
            <tbody>
              <tr>
                <th style={{ width: 140 }}>企業</th>
                <td>{DEMO_COMPANY}</td>
              </tr>
              <tr>
                <th>面談日</th>
                <td>{formatDateTimeJa(iv.scheduled_at)}</td>
              </tr>
              <tr>
                <th>実施方法</th>
                <td>{INTERVIEW_METHODS[iv.method] ?? iv.method}</td>
              </tr>
              <tr>
                <th>場所 / 接続先</th>
                <td>{iv.location}</td>
              </tr>
              <tr>
                <th>状態</th>
                <td>{INTERVIEW_STATUS[iv.status]}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>事前情報</h2>
          <p className="muted">企業担当者と産業医事務所の間で共有されます。対象の従業員本人には表示されません。入力が止まると自動で保存されます。</p>
          <textarea readOnly value={iv.pre_info} style={{ ...ro, minHeight: 100 }} />
        </div>

        <div className="card">
          <h2>実施記録（産業医事務所のみ・企業には共有されません）</h2>
          <div className="form-row">
            <label>実施日</label>
            <input type="date" readOnly value={iv.record?.conducted_date ?? ""} style={ro} />
          </div>
          <div className="form-row">
            <label style={{ color: "var(--orange)" }}>所見と指導内容（産業医事務所のみ・企業側には一切表示されません）</label>
            <textarea readOnly value={iv.record?.notes ?? ""} style={{ background: "var(--orange-light)", minHeight: 140 }} placeholder="面談後に入力します" />
          </div>
        </div>

        <div className="card">
          <h2>事業者向け 意見書</h2>
          <div className="form-row">
            <label>面談実施日（意見書に記載）</label>
            <input type="date" readOnly value={iv.opinion?.interview_date ?? ""} style={ro} />
          </div>
          <div className="form-row">
            <label>就業区分の判定</label>
            <input type="text" readOnly value={iv.opinion ? WORK_JUDGMENTS[iv.opinion.work_judgment] : "（未選択）"} style={{ ...ro, width: 200 }} />
          </div>
          <div className="form-row">
            <label>就業上の措置に関する意見（企業に公開されます）</label>
            <textarea readOnly value={iv.opinion?.opinion ?? ""} style={{ ...ro, minHeight: 100 }} placeholder="時間外労働の制限、業務内容の配慮 など" />
          </div>
          <div className="form-row">
            <label>産業医名</label>
            <input type="text" readOnly value={DEMO_PHYSICIAN} style={{ ...ro, width: 200 }} />
          </div>
          <div className="form-row checkbox-row">
            <input type="checkbox" readOnly checked={iv.opinion?.published ?? false} />
            <label style={{ margin: 0 }}>企業側に公開し、面談を実施済にする</label>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="btn" aria-disabled style={{ opacity: 0.6, cursor: "default" }}>意見書を保存</span>
            {iv.opinion?.published && (
              <Link className="btn secondary" href={`/demo/interview-sheet?id=${iv.id}`}>
                意見書を表示（印刷/PDF）
              </Link>
            )}
          </div>
          {iv.opinion?.published && (
            <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
              公開済み（発行日 {formatDateJa(iv.opinion.issued_date)}）。企業担当者の画面には、面談実施日・就業区分・この意見書だけが表示されます。
            </p>
          )}
        </div>
      </main>
    </>
  );
}
