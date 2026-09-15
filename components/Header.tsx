import Link from "next/link";
import AutoLogout from "@/components/AutoLogout";
import LogoutButton from "@/components/LogoutButton";
import type { Profile } from "@/lib/auth";
import { homePathFor } from "@/lib/auth";

const ROLE_LABEL: Record<string, string> = {
  office: "産業医事務所",
  company: "企業担当者",
  employee: "従業員",
  jimu: "実施事務従事者",
};

export default function Header({ profile }: { profile: Profile }) {
  // ストレスチェックWebへの導線は、URLが設定されているときだけ表示する
  const stressUrl = process.env.NEXT_PUBLIC_STRESS_URL;

  return (
    <header className="site-header no-print">
      <AutoLogout />
      <div className="inner">
        <Link
          href={homePathFor(profile.role)}
          className="brand"
          style={{ display: "flex", alignItems: "center", gap: 12 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="mestate うえまつ産業医事務所"
            style={{ height: 46, width: "auto", display: "block" }}
          />
          <span style={{ fontSize: 20, fontWeight: 800 }}>
            健康管理<span style={{ color: "var(--orange)" }}>Web</span>
          </span>
        </Link>
        <div className="header-right">
          {stressUrl && (
            <a href={stressUrl} target="_blank" rel="noopener noreferrer">
              ストレスチェックWeb ↗
            </a>
          )}
          <span>
            {profile.full_name ?? "—"}（{ROLE_LABEL[profile.role] ?? profile.role}）
          </span>
          {/* 氏名・所属・パスワードなどのアカウント設定はストレスチェックWeb側で行う
              (アカウントは両システムで共通)。事業者担当者・従業員に案内を出す */}
          {stressUrl && (profile.role === "company" || profile.role === "employee") && (
            <a
              href={`${stressUrl}/account`}
              target="_blank"
              rel="noopener noreferrer"
              title="氏名・所属・パスワードなどの設定はストレスチェックWebで行います"
              style={{ fontSize: 12, whiteSpace: "nowrap" }}
            >
              アカウント設定 ↗
            </a>
          )}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
