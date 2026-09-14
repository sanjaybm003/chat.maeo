import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TaskDetail } from "@/features/tasks/components/task-detail";

type Params = Promise<{ slug: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { number } = await params;
  return { title: `T-${number}` };
}

export default async function TaskPage({ params }: { params: Params }) {
  const { number } = await params;
  const parsed = Number(number);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== number) notFound();
  return <TaskDetail number={parsed} />;
}
