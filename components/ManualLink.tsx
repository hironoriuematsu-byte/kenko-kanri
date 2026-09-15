import Link from "next/link";

// 各画面の見出しの横に置く「使い方」リンク。該当セクションのマニュアルを開く
export default function ManualLink({ section }: { section: string }) {
  return (
    <Link
      href={`/company/manual?section=${section}`}
      className="manual-link no-print"
      title="この画面の使い方を見る"
    >
      ？ 使い方
    </Link>
  );
}
