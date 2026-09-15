import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Header from "@/components/Header";
import ManualView from "@/components/ManualView";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 事業者担当者向けの使い方マニュアル。実施者も確認できる(担当者に案内するため)
export default async function CompanyManualPage({
  searchParams,
}: {
  searchParams: { section?: string };
}) {
  const { profile } = await requireProfile();
  if (profile.role !== "company" && profile.role !== "office") redirect("/");

  return (
    <>
      <Header profile={profile} />
      <main className="container">
        <p className="muted">
          <Link href={profile.role === "office" ? "/office" : "/company"}>← ダッシュボード</Link>
        </p>
        <h1 className="page-title">健康管理Web 使い方（事業者担当者向け）</h1>
        <div className="card">
          <Suspense fallback={null}>
            <ManualView initialSection={searchParams.section} />
          </Suspense>
        </div>
      </main>
    </>
  );
}
