import type { Metadata } from "next";

import { ContactsScreen } from "@/features/contacts/components/contacts-screen";

export const metadata: Metadata = { title: "Contacts" };

export default function ContactsPage() {
  return <ContactsScreen />;
}
