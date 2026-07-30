import { redirect } from "next/navigation";
import { requireProfile, homePathFor } from "@/lib/auth";

export default async function Home() {
  const { profile } = await requireProfile();
  redirect(homePathFor(profile.role));
}
