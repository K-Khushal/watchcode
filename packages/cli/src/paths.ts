import { homedir } from "node:os";
import { join } from "node:path";

export interface WatchcodePaths {
  home: string;
  pidFile: string;
  logFile: string;
  claudeSettings: string;
}

export function defaultPaths(home: string = join(homedir(), ".watchcode")): WatchcodePaths {
  return {
    home,
    pidFile: join(home, "daemon.pid"),
    logFile: join(home, "logs", "daemon.log"),
    claudeSettings: join(homedir(), ".claude", "settings.json"),
  };
}
