import Link from "next/link";

export type ReportForm = "6" | "organic" | "chemical";

// 労基署報告の様式切り替え(定期健診 様式第6号 / 有機溶剤 様式第3号の2 / 特定化学物質 様式第3号)
export default function ReportTabs({
  basePath,
  current,
  counts,
  rounds,
  round,
}: {
  basePath: string; // 例: /office/<id>/checkups/report?year=2026 (実施回は含めない)
  current: ReportForm;
  counts: { regular: number; organic: number; chemical: number };
  rounds?: number[]; // 表示中の様式に存在する実施回(2回以上あるときだけ選択肢を出す)
  round?: number;
}) {
  const sep = basePath.includes("?") ? "&" : "?";
  const formQuery = current === "6" ? "" : `${sep}form=${current}`;
  const tabs: { key: ReportForm; label: string; n: number }[] = [
    { key: "6", label: "定期健診（様式第6号）", n: counts.regular },
    { key: "organic", label: "有機溶剤（様式第3号の2）", n: counts.organic },
    { key: "chemical", label: "特定化学物質（様式第3号）", n: counts.chemical },
  ];
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          className={`btn ${t.key === current ? "" : "secondary"}`}
          href={t.key === "6" ? basePath : `${basePath}${sep}form=${t.key}`}
          aria-current={t.key === current ? "page" : undefined}
        >
          {t.label}
          <span style={{ marginLeft: 6, opacity: 0.8 }}>{t.n}名</span>
        </Link>
      ))}
      {/* 同じ年度に複数回の健診がある様式では、実施回ごとに分けて集計する */}
      {rounds && rounds.length > 1 && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 8 }}>
          <span className="muted">実施回:</span>
          {rounds.map((r) => (
            <Link
              key={r}
              href={`${basePath}${formQuery}${formQuery || sep !== "?" ? "&" : "?"}round=${r}`}
              className={r === round ? "badge" : ""}
              style={r === round ? {} : { padding: "2px 8px" }}
            >
              第{r}回
            </Link>
          ))}
        </span>
      )}
    </div>
  );
}
