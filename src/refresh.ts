namespace Fedi {
  const pullThreshold = 72;
  let pullIndicator: HTMLElement | null = null;
  let pullLabel: HTMLElement | null = null;
  let pull: { id: number; x: number; y: number; distance: number; context: string; api: API | null } | undefined;
  let pullBusy = false;
  let pullTimer: ReturnType<typeof setTimeout> | undefined;

  function pullContext(): string {
    return JSON.stringify([location.hash, state.view, state.timeline, state.query,
      state.session?.account.id, state.profile?.id, state.profile?.tab]);
  }
  function showPull(mode = "", distance = 0): void {
    if (!pullIndicator || !pullLabel) return;
    pullIndicator.dataset.state = mode;
    pullIndicator.style.setProperty("--pull-distance", `${distance}px`);
    pullIndicator.style.setProperty("--pull-turn", `${distance * 4}deg`);
    const label = mode === "loading" ? "Refreshing…" : mode === "ready" ? "Release to refresh"
      : mode === "pulling" ? "Pull to refresh" : "";
    if (pullLabel.textContent !== label) pullLabel.textContent = label;
  }
  function cancelPull(): void {
    pull = undefined;
    if (!pullBusy) showPull();
  }
  export function updatePullRefresh(): void {
    if (!pullIndicator) return;
    document.documentElement.classList.toggle("pull-refresh-enabled", canRefreshReading());
    if (pull && (pull.context !== pullContext() || pull.api !== state.api)) cancelPull();
  }
  function pullAllowed(): boolean {
    return matchMedia("(max-width: 700px)").matches && canRefreshReading() &&
      !document.hidden && !(document.getElementById("modal") as HTMLDialogElement | null)?.open &&
      !document.activeElement?.matches("input,textarea,select,[contenteditable=true]") &&
      (window.visualViewport?.scale || 1) === 1;
  }
  function nestedTouch(target: Element): boolean {
    if (target.closest("button,input,textarea,select,summary,[contenteditable],.mobile-nav,dialog")) return true;
    for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if ((node.scrollHeight > node.clientHeight && /auto|scroll/.test(style.overflowY)) ||
          (node.scrollWidth > node.clientWidth && /auto|scroll/.test(style.overflowX))) return true;
    }
    return false;
  }
  function pullStart(event: TouchEvent): void {
    cancelPull();
    if (pullBusy || event.touches.length !== 1 || window.scrollY > 1 || !pullAllowed() ||
        nestedTouch(event.target as Element)) return;
    clearTimeout(pullTimer);
    const touch = event.touches[0];
    pull = { id: touch.identifier, x: touch.clientX, y: touch.clientY, distance: 0,
      context: pullContext(), api: state.api };
  }
  function pullMove(event: TouchEvent): void {
    if (!pull) return;
    if (event.touches.length !== 1 || !pullAllowed() || window.scrollY > 1 ||
        pull.context !== pullContext() || pull.api !== state.api) { cancelPull(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== pull.id) { cancelPull(); return; }
    const dx = Math.abs(touch.clientX - pull.x), dy = touch.clientY - pull.y;
    if (dy < 0 || (dx > 8 && dx > dy)) { cancelPull(); return; }
    if (dy <= 0 || dx > dy) return;
    // Cancel native overscroll only for a downward pull at the page boundary.
    if (!event.cancelable) { cancelPull(); return; }
    event.preventDefault();
    pull.distance = Math.min(96, dy * 0.5);
    showPull(pull.distance >= pullThreshold ? "ready" : "pulling", pull.distance);
  }
  async function pullEnd(): Promise<void> {
    const gesture = pull;
    pull = undefined;
    if (!gesture || gesture.distance < pullThreshold || !pullAllowed() || window.scrollY > 1 ||
        gesture.context !== pullContext() || gesture.api !== state.api) {
      if (!pullBusy) showPull();
      return;
    }
    pullBusy = true;
    showPull("loading", 56);
    const started = Date.now();
    try {
      if (navigator.onLine === false) toast("You’re offline. Your reading is still here.");
      else await refreshReading(Date.now(), true);
    } catch (error) {
      if (gesture.context === pullContext() && gesture.api === state.api) toast((error as Error).message);
    } finally {
      // Keep fast cache hits from flashing the indicator for a single frame.
      pullTimer = setTimeout(() => { pullBusy = false; showPull(); }, Math.max(0, 400 - (Date.now() - started)));
    }
  }
  export function setupPullRefresh(): void {
    if (pullIndicator) return;
    pullIndicator = document.getElementById("pull-refresh");
    pullLabel = document.getElementById("pull-refresh-label");
    if (!pullIndicator || !pullLabel) return;
    updatePullRefresh();
    document.addEventListener("touchstart", pullStart, { passive: true });
    document.addEventListener("touchmove", pullMove, { passive: false });
    document.addEventListener("touchend", () => { void pullEnd(); }, { passive: true });
    document.addEventListener("touchcancel", cancelPull, { passive: true });
    window.addEventListener("hashchange", () => { cancelPull(); showPull(); });
    window.addEventListener("resize", cancelPull);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelPull(); });
  }
}
