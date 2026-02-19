export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureWorkerStarted } = await import("@/lib/datagen/jobWorker");
    ensureWorkerStarted();
  } catch (error) {
    console.error("Worker bootstrap failed", error);
  }
}
