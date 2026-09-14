import { indexBy } from "../helpers";
import type { IntegrationsSlice, SliceCreator, TasksSlice } from "../types";

export const createTasksSlice: SliceCreator<TasksSlice> = (set, _get, bootstrap) => ({
  tasksReady: bootstrap.tasks.ready,
  tasks: indexBy(bootstrap.tasks.items),

  // A full reload wins, except over copies that are already newer.
  setTasks: (tasks) =>
    set((state) => {
      const next = indexBy(tasks);
      for (const task of tasks) {
        const current = state.tasks[task.id];
        if (current && current.version > task.version) next[task.id] = current;
      }
      return { tasks: next };
    }),

  upsertTask: (task) =>
    set((state) => {
      const current = state.tasks[task.id];
      if (current && current.version > task.version) return {};
      return { tasks: { ...state.tasks, [task.id]: task } };
    }),

  removeTask: (taskId) =>
    set((state) => {
      if (!state.tasks[taskId]) return {};
      const tasks = { ...state.tasks };
      delete tasks[taskId];
      return { tasks };
    }),
});

export const createIntegrationsSlice: SliceCreator<IntegrationsSlice> = (set, _get, bootstrap) => ({
  githubAvailable: bootstrap.integrations.githubAvailable,
  integrations: bootstrap.integrations.items,

  setIntegrations: (integrations) => set({ integrations }),
});
