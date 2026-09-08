# Automatic check-in drafts

Check-in text, module notes and habit status changes now autosave to the account's existing cloud database after 900 ms of inactivity. A five-second interval bounds the wait while typing continuously; hiding the page also attempts a flush. The interface distinguishes waiting, syncing, saved and error. Check-in completion remains an explicit action, so autosave does not make unfinished content eligible for AI analysis.

The writer serializes saves and retains newer edits made during an in-flight request. A mutation ID permits acknowledgment of a saved request whose response was lost. Optimistic revisions reject a conflicting write from another session. The UI retains unsynced text in the current tab and offers Retry sync; it does not silently merge or overwrite another device's version.

In-app navigation while dirty asks whether to save, discard or stay. Budget and workout forms retain their existing explicit saves and block navigation with a stay/save-or-cancel explanation; they are not automatically saved by the check-in writer. Setup changes can be saved through the navigation dialog. Closing or refreshing with outstanding changes uses the browser's native leave-page warning. Browser-controlled text cannot offer a custom Save button, and mobile browsers may not fire it, so autosave is the primary protection. [MDN beforeunload documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

There is no offline local backup, background-sync service worker or real-time multi-device subscription. A successful saved status means the server acknowledged the write. Unsynced text can still be lost if the tab/browser process is terminated without an unload event. Offline failures need an explicit Retry sync. Opening the app reloads persisted records; a conflict keeps local edits for copying/reapplying.

Verified with synthetic writer races, lost-response retries, SQLite version conflict tests and the compiled Worker/D1 route. Browser interaction and physical-device exit behavior have not been tested.
