import Link from "next/link";
import IkenSignupForm from "@/components/IkenSignupForm";

export const metadata = { title: "会社の登録 | 健診結果の医師意見聴取Web" };

export default function IkenSignupPage() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <p className="muted">
        <Link href="/iken">← サービスのご案内</Link>
      </p>
      <h1 className="page-title">会社の登録(無料)</h1>
      <IkenSignupForm />
    </div>
  );
}
