import OfficeNoticePage from "../notices/OfficeNoticePage";

export const dynamic = "force-dynamic";

// 産業医面談通知書(実施者向け)
export default function Page(props: { params: { companyId: string }; searchParams: { year?: string; round?: string } }) {
  return <OfficeNoticePage kind="interview" {...props} />;
}
