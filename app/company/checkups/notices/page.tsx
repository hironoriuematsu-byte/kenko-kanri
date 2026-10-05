import CompanyNoticePage from "./CompanyNoticePage";

export const dynamic = "force-dynamic";

// 受診勧奨通知書(事業者担当者向け)
export default function Page(props: { searchParams: { year?: string; round?: string } }) {
  return <CompanyNoticePage kind="consult" {...props} />;
}
