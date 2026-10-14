/** Built for static hosting (npm run build:standalone): there is no server to ask. */
export const OFFLINE_BUILD = import.meta.env.VITE_STANDALONE === 'true';

/** The café runs in the browser when the build says so or the address asks for it
 * (?offline=1). Otherwise the page tries the servers first and falls back to the
 * browser only when they do not answer. */
export function offlineRequested(search: string, build = OFFLINE_BUILD): boolean {
  return build || new URLSearchParams(search).get('offline') === '1';
}
