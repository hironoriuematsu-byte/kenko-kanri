import Link from "next/link";
import { roundCaption, type RoundInfo } from "@/lib/checkups";

export type ReportForm = "6" | "organic" | "chemical" | "pneumo";

// 労基署報告の様式切り替え(定期健診 様式第6号 / 有機溶剤 様式第3号の2 / 特定化学物質 様式第3号 / じん肺 様式第8号)と、
// 年度・実施回の切り替え。様式の番号は各集計表の見出しに出るので、タブには健診の名前だけを出す
export default function ReportTabs({
  path,
  year,
  years,
  current,
  counts,
  rounds,
  round,
}: {
  path: string; // 例: /office/<id>/checkups/report (年度などは含めない)
  year: number; // 表示中の年度
  years: number[]; // 健診結果が登録されている年度(新しい順)
  current: ReportForm;
  // タブを押したときに表示される回の人数(年に複数回ある様式は、表示中の回、または最初の回)。じん肺は台帳の在籍者数
  counts: { regular: number; organic: number; chemical: number; pneumo: number };
  rounds?: RoundInfo[]; // 表示中の様式に存在する実施回(2回以上あるときだけ選択肢を出す)
  round?: number;
}) {
  const formQuery = current === "6" ? "" : `&form=${current}`;
  const tabs: { key: ReportForm; label: string; n: number }[] = [
    { key: "6", label: "定期健診", n: counts.regular },
    { key: "organic", label: "有機溶剤", n: counts.organic },
    { key: "chemical", label: "特定化学物質", n: counts.chemical },
    { key: "pneumo", label: "じん肺", n: counts.pneumo },
  ];
  const yearList = years.includes(year) ? years : [year, ...years];
  return (
    <div className="no-print" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <Link
            key={t.key}
            className={`btn ${t.key === current ? "" : "secondary"}`}
            href={`${path}?year=${year}${t.key === "6" ? "" : `&form=${t.key}`}`}
            aria-current={t.key === current ? "page" : undefined}
            style={{ whiteSpace: "nowrap" }}
          >
            {t.label}
            <span style={{ marginLeft: 6, opacity: 0.8 }}>{t.n}名</span>
          </Link>
        ))}
      </div>
      {/* じん肺(様式第8号)は暦年で数えるので、対象年はじん肺の集計表の上で切り替える */}
      {current !== "pneumo" && (
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0 0" }}>
          <span className="muted">年度:</span>
          {yearList.map((y) => (
            <Link
              key={y}
              href={`${path}?year=${y}${formQuery}`}
              className={y === year ? "badge" : ""}
              style={y === year ? {} : { padding: "2px 8px" }}
              aria-current={y === year ? "true" : undefined}
            >
              {y}年度
            </Link>
          ))}
          {/* 同じ年度に複数回の健診がある様式では、実施回ごとに分けて集計する */}
          {rounds && rounds.length > 1 && (
            <>
              <span className="muted" style={{ marginLeft: 12 }}>実施回:</span>
              {rounds.map((r) => (
                <Link
                  key={r.round}
                  href={`${path}?year=${year}${formQuery}&round=${r.round}`}
                  className={r.round === round ? "badge" : ""}
                  style={r.round === round ? {} : { padding: "2px 8px" }}
                >
                  {roundCaption(r)}
                </Link>
              ))}
            </>
          )}
        </p>
      )}
    </div>
  );
}
