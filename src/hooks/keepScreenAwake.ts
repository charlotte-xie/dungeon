// Keeps the screen on while a long run is going, so a phone or tablet doesn't
// lock and send the page to the background, where the browser may cut its
// requests short. It can't keep a page running in the background: the browser
// lets go of the lock whenever the page is hidden, so it is taken again each
// time the page is back. Where the browser has no wake lock, or refuses one,
// the run just carries on without it. Returns the function that lets go.
export function keepScreenAwake(): () => void {
  if (!('wakeLock' in navigator)) return () => {}
  let held = true
  let lock: WakeLockSentinel | null = null
  function take() {
    if (!held || document.hidden) return
    navigator.wakeLock.request('screen').then(
      (taken) => {
        if (held) lock = taken
        else void taken.release().catch(() => {})
      },
      () => {},
    )
  }
  function onVisibilityChange() {
    if (!document.hidden) take()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  take()
  return () => {
    held = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    void lock?.release().catch(() => {})
    lock = null
  }
}
