import * as NodeFS from "node:fs";

// A second supervisor's startup cleanup pkills the first one's Electron, so a stray or stale
// launcher can take down the live app. Only a live launcher claims the lock; every launcher checks it.
export function acquireLauncherLock({ file, pid, claim, isLauncher }) {
  let holder = null;
  let ageMs = 0;
  try {
    holder = JSON.parse(NodeFS.readFileSync(file, "utf8")).pid;
    ageMs = Date.now() - NodeFS.statSync(file).mtimeMs;
  } catch {}
  if (Number.isInteger(holder) && holder !== pid && isLauncher(holder, ageMs)) {
    return { acquired: false, holder };
  }
  if (claim) NodeFS.writeFileSync(file, JSON.stringify({ pid }));
  return {
    acquired: true,
    release() {
      try {
        if (JSON.parse(NodeFS.readFileSync(file, "utf8")).pid === pid) {
          NodeFS.rmSync(file, { force: true });
        }
      } catch {}
    },
  };
}
