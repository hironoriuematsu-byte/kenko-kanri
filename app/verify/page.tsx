import { redirect } from "next/navigation";
import { currentLogin } from "@/lib/secondStepServer";
import { maskEmail, safeNext } from "@/lib/secondStep";
import VerifyForm from "@/components/VerifyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "確認コードの入力", robots: { index: false, follow: false } };

// 二段階認証: メールに届いた確認コードを入力する画面
export default async function VerifyPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNext(searchParams.next);
  const { user } = await currentLogin();
  if (!user) redirect("/login");
  return <VerifyForm next={next} email={maskEmail(user.email)} />;
}
