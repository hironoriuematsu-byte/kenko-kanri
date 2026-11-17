import Link from "next/link";
import type { JudgmentWork } from "@/lib/judgmentWork";

// 産業医事務所ダッシュボードの最初に出す「就業判定のお仕事」。
// 就業判定が未入力・判定保留の健診結果がある企業と人数を示し、その健診の一覧へ直接進めるようにする
export default function JudgmentWorkCard({ work }: { work: JudgmentWork }) {
  const total = work.unjudged + work.held;
  if (total === 0) {
    return (
      <div className="card">
        <h2>健康診断の就業判定</h2>
        <p className="muted" style={{ margin: 0 }}>
          就業判定が必要な健診結果は、いまはありません。
        </p>
      </div>
    );
  }
  return (
    <div className="card" style={{ borderColor: "var(--orange)", background: "var(--orange-light)" }}>
      <h2>健康診断の就業判定があります</h2>
      <p style={{ margin: "0 0 10px", fontSize: 15 }}>
        {work.companies.length}社で、就業判定が未入力 <strong style={{ fontSize: 18 }}>{work.unjudged}名</strong>
        {work.severe > 0 && (
          <>
            (うち総合判定D <strong style={{ color: "#b02a2a" }}>{work.severe}名</strong>)
          </>
        )}
        {work.held > 0 && (
          <>
            ・判定保留 <strong style={{ fontSize: 18 }}>{work.held}名</strong>
          </>
        )}
      </p>
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }}>
        {work.companies.map((c, ci) => (
          <div key={c.companyId} style={{ padding: "10px 14px", borderTop: ci === 0 ? "none" : "1px solid var(--line)" }}>
            <div style={{ fontWeight: 700, color: "var(--teal-dark)", marginBottom: 4 }}>{c.name}</div>
            {c.parts.map((p) => (
              <div key={p.href} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "3px 0" }}>
                <span style={{ flex: "1 1 220px", fontSize: 14 }}>{p.label}</span>
                <span style={{ fontSize: 14, whiteSpace: "nowrap" }}>
                  {p.unjudged > 0 && (
                    <>
                      未入力 <strong>{p.unjudged}名</strong>
                      {p.severe > 0 && <span style={{ color: "#b02a2a" }}> (D {p.severe}名)</span>}
                    </>
                  )}
                  {p.unjudged > 0 && p.held > 0 && "・"}
                  {p.held > 0 && (
                    <>
                      保留 <strong>{p.held}名</strong>
                    </>
                  )}
                </span>
                <Link href={p.href} className="btn orange" style={{ padding: "5px 14px", fontSize: 13 }}>
                  判定する
                </Link>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
        総合判定Dの方は個別に、それ以外の方は一覧からまとめて判定できます。
      </p>
    </div>
  );
}
