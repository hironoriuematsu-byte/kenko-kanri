import Link from "next/link";
import { DOCTOR, SELLER } from "@/lib/org";
import {
  COMPARE_HEAD,
  COMPARE_NOTE,
  COMPARE_ROWS,
  DELIVERABLES,
  FAQ,
  formatYen,
  HEADLINE,
  KEY_POINTS,
  OBLIGATION_POINTS,
  PRICE_NOTES,
  priceExamples,
  RETURN_RULES,
  STEPS,
  SUBHEAD,
} from "@/lib/iken";

// 健診結果の医師意見聴取Web(50人未満の事業場向け)の宣伝ページ(ログイン不要)
export default function IkenLandingPage() {
  return (
    <>
      <section className="iken-hero">
        <p className="badge orange" style={{ marginBottom: 10 }}>労働者50人未満の事業場向け</p>
        <h1>{HEADLINE}</h1>
        <p>{SUBHEAD}</p>
        <Link href="/iken/signup" className="iken-cta">
          会社を登録する(無料)
        </Link>
        <span className="muted" style={{ marginLeft: 12 }}>
          登録済みの方は <Link href="/login">ログイン</Link>
        </span>
      </section>

      <div className="card-grid" style={{ marginBottom: 18 }}>
        {KEY_POINTS.map((k) => (
          <div key={k.title} className="iken-point">
            <strong>{k.title}</strong>
            <span>{k.text}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>健診結果の「医師の意見聴取」は、50人未満の事業場にも義務があります</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {OBLIGATION_POINTS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>ご利用の流れ</h2>
        <ol className="iken-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <div className="muted" style={{ fontSize: 14 }}>{s.text}</div>
            </li>
          ))}
        </ol>
        <ul className="muted" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
          {RETURN_RULES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>お返しするもの</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {DELIVERABLES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>
          画面のイメージは <Link href="/demo">健康管理Webのデモ</Link> でご覧いただけます(架空のデータです)。
        </p>
      </div>

      <div className="card">
        <h2>料金(税込)</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                <th>健診結果の件数</th>
                <th>料金</th>
                <th>内訳</th>
              </tr>
            </thead>
            <tbody>
              {priceExamples().map((r) => (
                <tr key={r.seats}>
                  <td>{r.seats}件</td>
                  <td style={{ fontWeight: 700 }}>{formatYen(r.total)}</td>
                  <td className="muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="muted" style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          {PRICE_NOTES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>ほかの方法との比較</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead>
              <tr>
                {COMPARE_HEAD.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r) => (
                <tr key={r[0]}>
                  <th style={{ whiteSpace: "nowrap" }}>{r[0]}</th>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td style={{ fontWeight: 700, color: "var(--teal-dark)" }}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>{COMPARE_NOTE}</p>
      </div>

      <div className="card">
        <h2>意見を述べる医師</h2>
        <p style={{ margin: 0 }}>
          <strong>{DOCTOR.full}</strong>({DOCTOR.officeName})
        </p>
        <p className="muted" style={{ margin: "4px 0 0" }}>{DOCTOR.career.join(" / ")}</p>
      </div>

      <div className="card">
        <h2>よくあるご質問</h2>
        {FAQ.map(([q, a]) => (
          <details key={q} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>{q}</summary>
            <p style={{ margin: "6px 0 0" }}>{a}</p>
          </details>
        ))}
      </div>

      <div style={{ textAlign: "center", margin: "24px 0" }}>
        <Link href="/iken/signup" className="iken-cta">
          会社を登録する(無料)
        </Link>
        <p className="muted">
          ご不明な点は <a href={`mailto:${SELLER.email}`}>{SELLER.email}</a> までお問い合わせください。
        </p>
      </div>
    </>
  );
}
