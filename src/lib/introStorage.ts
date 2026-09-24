const KEY = "core.intro.seen.v1";

/** Whether the full load sequence already played on this device (localStorage, guarded). */
export function readIntroSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeIntroSeen(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* private mode or blocked storage: the intro simply plays again next time */
  }
}
