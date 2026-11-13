"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readListReturn } from "@/lib/listReturn";

// 「← 一覧に戻る」: 一覧から開いたときは、そのときの一覧(年度・実施回・区分)に戻る。
// 一覧の側で、開いた人の行までスクロールする(CheckupsTable)
export default function BackToListLink({ defaultHref, children }: { defaultHref: string; children: React.ReactNode }) {
  const [href, setHref] = useState(defaultHref);
  useEffect(() => {
    const r = readListReturn();
    if (r && r.url.split("?")[0] === defaultHref) setHref(r.url);
  }, [defaultHref]);
  return <Link href={href}>{children}</Link>;
}
