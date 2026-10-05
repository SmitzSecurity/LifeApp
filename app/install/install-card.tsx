'use client';
import {useState, useSyncExternalStore} from 'react';
import {createInstallController} from '@/lib/life/pwa-install';
import styles from './install.module.css';

export default function InstallCard() {
  const [controller] = useState(() => createInstallController(typeof window === 'undefined' ? undefined : window));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  const message = state.installed ? 'LifeApp is installed or running in its app window.'
    : state.status === 'accepted' ? 'Installation requested. Finish the browser prompts, then open the LifeApp icon.'
    : state.status === 'dismissed' ? 'Installation was cancelled. You can keep using LifeApp in your browser.'
    : state.status === 'error' ? 'The install prompt could not open. Use the browser instructions below.'
    : state.status === 'prompting' ? 'Choose Install in the browser prompt, or cancel to return here.' : '';
  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="install-title">
      <span className={styles.icon} aria-hidden="true" />
      <p className={styles.eyebrow}>LIFEAPP · INSTALLABLE BETA</p>
      <h1 id="install-title">Your day, one tap away.</h1>
      <p>Add LifeApp to your home screen and open it in its own app window. This is the same LifeApp, not a separate account.</p>
      <div className={styles.actions}>
        {!state.installed && state.secure && (state.canPrompt || state.status === 'prompting') && <button type="button" className={styles.primary} disabled={state.status === 'prompting'} onClick={() => {void controller.requestInstall();}}>{state.status === 'prompting' ? 'Check your browser prompt…' : 'Install LifeApp'}</button>}
        <a className={styles.secondary} href="/">Open LifeApp</a>
      </div>
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
      {!state.secure && <p role="alert">Installation needs a secure connection. Open the normal HTTPS LifeApp address in your browser.</p>}
      {!state.installed && <section aria-labelledby="install-help">
        <h2 id="install-help">Install from your browser</h2>
        <p className={styles.muted}>No install button? Your browser may require its own menu. In an email or social app, open this page in your regular browser first.</p>
        <details className={styles.guide} open={state.platform === 'ios'}>
          <summary>iPhone or iPad</summary>
          <ol><li>Open this page in Safari.</li><li>Open <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>. You may need to scroll through the actions.</li><li>Keep <strong>Open as Web App</strong> enabled when shown, then tap <strong>Add</strong>.</li></ol>
        </details>
        <details className={styles.guide} open={state.platform === 'android'}>
          <summary>Android</summary>
          <ol><li>Open this page in Chrome.</li><li>Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm installation, then open the <strong>LifeApp</strong> icon.</li></ol>
          <p className={styles.muted}>Other Android browsers may use different wording or create a browser shortcut instead.</p>
        </details>
        <details className={styles.guide} open={state.platform === 'desktop'}>
          <summary>Computer</summary>
          <p>In Chrome or Edge, use the install icon in the address bar or the browser menu. On a Mac in Safari, choose <strong>File → Add to Dock</strong>.</p>
        </details>
      </section>}
      <section className={styles.note} aria-labelledby="install-next">
        <h2 id="install-next">After adding LifeApp</h2>
        <p>Open the new icon and sign in with your existing Google account if asked. Access remains limited to invited beta accounts.</p>
        <p>Connect for the first launch. For offline use, check the save status in LifeApp: saved on this device is different from synced to your account. Sync pending changes before clearing browser data or changing devices.</p>
        <p className={styles.muted}>Installation does not turn on notifications, background uploads, billing, or extra Google permissions.</p>
      </section>
    </section>
  </main>;
}
