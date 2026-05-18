// src/notifiers/desktop-sound.ts
import { spawn } from "node:child_process";
import type { Notifier } from "../types.js";

const SOUND_FILE = "/System/Library/Sounds/Glass.aiff";

export function createDesktopSoundNotifier(): Notifier {
  return {
    async notify() {
      try {
        spawn("afplay", [SOUND_FILE], { detached: true, stdio: "ignore" }).unref();
      } catch {
        // best-effort
      }
    },
  };
}
