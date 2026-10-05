/** Installation UI only: no authentication, storage, navigation or service-worker changes. */
export type InstallPlatform = 'unknown' | 'ios' | 'android' | 'desktop';
export type InstallStatus = 'idle' | 'prompting' | 'accepted' | 'dismissed' | 'error';
export type InstallSnapshot = Readonly<{
  platform: InstallPlatform;
  installed: boolean;
  secure: boolean;
  canPrompt: boolean;
  status: InstallStatus;
}>;
type Choice = {outcome: 'accepted' | 'dismissed'};
type InstallPrompt = Event & {prompt: () => Promise<Choice | void>; userChoice?: Promise<Choice>};
type InstallWindow = Pick<Window, 'navigator' | 'matchMedia' | 'addEventListener' | 'removeEventListener' | 'isSecureContext'>;
const serverSnapshot: InstallSnapshot = Object.freeze({platform: 'unknown', installed: false, secure: true, canPrompt: false, status: 'idle'});

export function installPlatform(navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): InstallPlatform {
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
}

export function createInstallController(browser?: InstallWindow) {
  let snapshot = serverSnapshot;
  let deferred: InstallPrompt | null = null;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function publish(change: Partial<InstallSnapshot>) {
    snapshot = Object.freeze({...snapshot, ...change});
    for (const listener of listeners) listener();
  }
  function start() {
    if (!browser) return;
    const media = browser.matchMedia('(display-mode: standalone)');
    const installed = () => media.matches || (browser.navigator as Navigator & {standalone?: boolean}).standalone === true;
    const onDisplay = () => {
      const standalone = installed();
      if (standalone) deferred = null;
      publish({installed: standalone, canPrompt: !standalone && !!deferred, status: 'idle'});
    };
    const onPrompt = (event: Event) => {
      const candidate = event as InstallPrompt;
      if (!browser.isSecureContext || snapshot.installed || typeof candidate.prompt !== 'function') return;
      event.preventDefault();
      deferred = candidate;
      publish({canPrompt: snapshot.status !== 'prompting'});
    };
    const onInstalled = () => {
      deferred = null;
      publish({installed: true, canPrompt: false, status: 'idle'});
    };
    browser.addEventListener('beforeinstallprompt', onPrompt);
    browser.addEventListener('appinstalled', onInstalled);
    media.addEventListener('change', onDisplay);
    publish({platform: installPlatform(browser.navigator), installed: installed(), secure: browser.isSecureContext, canPrompt: !!deferred && !installed()});
    stop = () => {
      browser.removeEventListener('beforeinstallprompt', onPrompt);
      browser.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onDisplay);
    };
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {stop?.(); stop = undefined;}
      };
    },
    async requestInstall(): Promise<boolean> {
      if (!deferred || !snapshot.secure || snapshot.installed || snapshot.status === 'prompting') return false;
      // Consume exactly once and call prompt synchronously within the user's click.
      const event = deferred;
      deferred = null;
      publish({canPrompt: false, status: 'prompting'});
      try {
        const result = await event.prompt();
        const choice = result ?? (event.userChoice ? await event.userChoice : undefined);
        // Accepting a prompt is not proof that installation completed.
        if (!snapshot.installed) publish({status: choice?.outcome === 'accepted' ? 'accepted' : choice?.outcome === 'dismissed' ? 'dismissed' : 'idle', canPrompt: !!deferred});
        return choice?.outcome === 'accepted';
      } catch {
        if (!snapshot.installed) publish({status: 'error', canPrompt: !!deferred});
        return false;
      }
    },
  };
}
