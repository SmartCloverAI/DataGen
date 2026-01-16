import fs from "fs/promises";
import path from "path";

const DEFAULT_VERSION = "dev";

export async function getAppVersion(): Promise<string> {
  const versionPath = path.join(process.cwd(), "VERSION");
  try {
    const raw = await fs.readFile(versionPath, "utf8");
    const version = raw.trim();
    return version.length > 0 ? version : DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}
