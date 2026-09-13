import type { Metadata } from "next";

import { CheckEmailView } from "@/features/auth/components/check-email-view";

export const metadata: Metadata = { title: "Confirm your email" };

export default function CheckEmailPage() {
  return <CheckEmailView />;
}
