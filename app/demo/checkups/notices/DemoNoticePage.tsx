import Link from "next/link";
import DemoHeader from "@/components/DemoHeader";
import DemoNotice from "../../DemoNotice";
import CheckupNoticesView from "@/components/CheckupNoticesView";
import { DEMO_COMPANY, DEMO_COMPANY_ADDRESS, DEMO_FISCAL_YEAR, DEMO_OFFICE, demoCheckups } from "@/lib/demo-data";
import { needsAttention } from "@/lib/checkups";
import { NOTICE_TEMPLATES, type NoticeKind } from "@/lib/notice";

// 紹介用デモ: 受診勧奨通知書・産業医面談通知書(1人1ページ・QRコード付き)。
// 実際の画面と同じ部品で表示し、印刷/PDF保存はできるが、勧奨済への更新・面談予定の登録はできない
export default function DemoNoticePage({ kind }: { kind: NoticeKind }) {
  const tpl = NOTICE_TEMPLATES[kind];
  const { rows } = demoCheckups();
  const targets = rows.filter((c) => !needsAttention(c.work_judgment) && tpl.isTarget(c));
  return (
    <>
      <DemoHeader />
      <main className="container">
        <p className="muted no-print">
          <Link href="/demo/checkups">← 健康診断管理に戻る</Link>
        </p>
        <h1 className="page-title no-print">
          {DEMO_COMPANY} — {tpl.label}書の作成（{DEMO_FISCAL_YEAR}年度）
        </h1>
        <DemoNotice />
        <div className="notice no-print" style={{ marginBottom: 14 }}>
          {kind === "interview"
            ? "就業判定が要就業制限・要休業の方と、医師の意見に「産業医面談」を含む方へ渡す面談の案内です。対象者は絞り込み済みです。実際の画面では、面談日を入れて「産業医面談管理に登録」を押すと面談予定がまとめて登録されます(デモでは無効)。"
            : "受診勧奨となった方へ渡す受診の案内です。対象者は絞り込み済みです。各ページのQRコードを読み取ると、本人のスマートフォンに受診報告の画面が開きます(デモのQRコードはサンプルの報告画面を開きます。送信しても保存されません)。実際の画面では、出力後に「通知した方を勧奨済にする」で一覧の受診勧奨をまとめて更新できます(デモでは無効)。"}
        </div>
        <CheckupNoticesView
          kind={kind}
          companyName={DEMO_COMPANY}
          companyAddress={DEMO_COMPANY_ADDRESS}
          officeInfo={DEMO_OFFICE}
          fiscalYear={DEMO_FISCAL_YEAR}
          rows={targets}
          canFollowup={false}
          demo
        />
      </main>
    </>
  );
}
