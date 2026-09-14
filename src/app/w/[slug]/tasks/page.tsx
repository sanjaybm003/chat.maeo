import type { Metadata } from "next";

import { TasksScreen } from "@/features/tasks/components/tasks-screen";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return <TasksScreen />;
}
