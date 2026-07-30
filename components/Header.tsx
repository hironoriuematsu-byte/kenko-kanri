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
  return (
    <header className="site-header no-print">
      <AutoLogout />
      <div className="inner">
        <Link href={homePathFor(profile.role)} className="brand">
          健康管理Web
          <span className="sub">うえまつ産業医事務所</span>
        </Link>
        <div className="header-right">
          <span>
            {profile.full_name ?? "—"}（{ROLE_LABEL[profile.role] ?? profile.role}）
          </span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
