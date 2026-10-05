import CompanyNoticePage from "../notices/CompanyNoticePage";

export const dynamic = "force-dynamic";

// 産業医面談通知書(事業者担当者向け)
export default function Page(props: { searchParams: { year?: string; round?: string } }) {
  return <CompanyNoticePage kind="interview" {...props} />;
}
