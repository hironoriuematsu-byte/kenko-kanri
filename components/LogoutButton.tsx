"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="btn secondary"
      style={{ padding: "5px 12px", fontSize: 12 }}
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
      }}
    >
      ログアウト
    </button>
  );
}
