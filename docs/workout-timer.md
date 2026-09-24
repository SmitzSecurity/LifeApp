# Workout rest timer across app pages

September 24, 2026. The shared app header shows the active workout's rest countdown on every page, including while scrolling a page. Clicking it returns through the normal navigation guard to Workouts. Its absolute deadline comes from the saved workout; navigating, backgrounding and returning never restart rest. The header switches to Ready when the deadline expires, and disappears when rest is cleared or the workout finishes or is cancelled.

Workout information includes a Phone rest notifications toggle. Enabling it requests browser notification permission only from that click. Notifications show the local rest end time and can return to the workout. Extending rest replaces the deadline notification; skipping rest, finishing, cancelling or turning notifications off removes it. These notifications include no exercise names, health notes or other account content. They are silent; existing optional sound and vibration controls remain separate.

This web implementation does not provide a native, continuously updating notification countdown or a guaranteed background alarm. A suspended web page cannot reliably run a timer. The notification therefore displays the fixed end time, and changes to Rest complete when the page is able to execute. No push subscription, server notification job, paid provider or background workout write is created. Phone notification support depends on browser permissions and platform support. On iPhone/iPad, open LifeApp as a Home Screen web app.

The service worker handles notification clicks: it focuses an existing app window and sends a navigation request, or opens `/?workout=active`. The app preserves editor navigation guards and does not replay saves from a notification. The worker is shared with offline app support.

Platform references: [MDN showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification), [WebKit Home Screen notification support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Verification uses synthetic deadlines and browser fixtures. Physical notification-panel behavior, operating-system suspension, and audible/vibration delivery require device testing. No live account notification permission or production write is used for development checks.
