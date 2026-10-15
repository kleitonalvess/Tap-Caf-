import { renderLoginPage, renderSessionError } from './auth/LoginPage';
import { resolveSession } from './game/session';
import { offlineRequested } from './standalone/mode';

async function start(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app não encontrado');
  document.body.classList.add('auth-page');
  if (offlineRequested(window.location.search)) {
    await playOffline(host);
    return;
  }
  const playing = window.location.pathname === '/play' || window.location.pathname === '/play/';
  host.innerHTML = '<p class="auth-check" role="status">Verificando sessão…</p>';
  let session;
  try {
    session = await resolveSession();
  } catch (error) {
    // The servers do not answer: the same café runs in this browser instead.
    console.warn('[sessão] servidor indisponível; abrindo o café offline', error);
    await playOffline(host, error);
    return;
  }
  try {
    if (playing) {
      if (!session) {
        const room = new URLSearchParams(window.location.search).get('room');
        window.location.replace(room ? '/?room=' + encodeURIComponent(room) : '/');
        return;
      }
      document.body.classList.remove('auth-page');
      host.replaceChildren();
      await allowStrictHosts();
      await import('./play');
      const checkAccess = async () => {
        if (document.hidden) return;
        try {
          if (!await resolveSession()) window.location.replace('/');
        } catch { /* Uma falha de rede temporária não encerra uma sessão válida. */ }
      };
      window.addEventListener('pageshow', () => { void checkAccess(); });
      document.addEventListener('visibilitychange', () => { void checkAccess(); });
      window.addEventListener('storage', (event) => {
        if (event.key === 'coffe-auth-change') void checkAccess();
      });
    } else {
      renderLoginPage(host, session);
    }
  } catch (error) {
    renderSessionError(host, error);
  }
}

/** Hosts whose Content-Security-Policy forbids eval (some embedded and static
 * hosts) still run Pixi through its eval-free module, a little slower. Pixi
 * otherwise refuses to create the renderer there. */
async function allowStrictHosts(): Promise<void> {
  try {
    new Function('return 0')();
  } catch {
    await import('pixi.js/unsafe-eval');
  }
}

/** Plays with the café in the browser (Go/WASM in a worker, save in IndexedDB). */
async function playOffline(host: HTMLElement, cause?: unknown): Promise<void> {
  host.innerHTML = '<p class="auth-check" role="status">Abrindo o café offline…</p>';
  try {
    const { startLocalBackend } = await import('./standalone/local-backend');
    await startLocalBackend();
  } catch (error) {
    console.error('[offline] o café não abriu', error);
    const reason = error instanceof Error ? error.message : 'O café offline não abriu.';
    renderSessionError(host, new Error(cause ? `O servidor não respondeu, e o café offline não abriu: ${reason}` : reason));
    return;
  }
  document.body.classList.remove('auth-page');
  host.replaceChildren();
  await allowStrictHosts();
  await import('./play');
}

void start();
