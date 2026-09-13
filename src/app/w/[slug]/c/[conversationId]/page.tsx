import { notFound } from "next/navigation";

import { ConversationScreen } from "@/features/chat/components/conversation-screen";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; conversationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(conversationId)) notFound();

  const focusMessageId = typeof query.message === "string" && UUID.test(query.message) ? query.message : undefined;

  return <ConversationScreen key={conversationId} conversationId={conversationId} focusMessageId={focusMessageId} />;
}
