import { formatDateJa } from "@/lib/fiscal";

// 日付を「2026年」と「10月21日」の2行で表示する(表の列幅が狭いときに途中で折り返さないように)
export default function DateTwoLines({ date }: { date: string | null | undefined }) {
  const s = formatDateJa(date);
  const i = s.indexOf("年");
  if (i < 0) return <>{s}</>;
  return (
    <>
      <span style={{ whiteSpace: "nowrap" }}>{s.slice(0, i + 1)}</span>
      <br />
      <span style={{ whiteSpace: "nowrap" }}>{s.slice(i + 1)}</span>
    </>
  );
}
