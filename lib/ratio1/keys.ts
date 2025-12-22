export const METRICS_KEY = "datagen:metrics";
export const userTasksHash = (username: string) =>
  `datagen:user:${username}:tasks`;
export const taskKey = (taskId: string) => `datagen:task:${taskId}`;
export const userSettingsKey = (username: string) =>
  `datagen:user:${username}:settings`;
