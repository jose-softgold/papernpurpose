/**
 * Host used to reach Firebase emulators.
 * Prefer the hostname of the page so phone (LAN IP) and laptop (localhost)
 * both work without a stale VITE_EMULATOR_HOST.
 */
export function emulatorHost(): string {
  if (typeof window !== 'undefined') {
    const pageHost = window.location.hostname
    if (pageHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      return pageHost
    }
  }
  const configured = String(import.meta.env.VITE_EMULATOR_HOST ?? '').trim()
  return configured || 'localhost'
}
