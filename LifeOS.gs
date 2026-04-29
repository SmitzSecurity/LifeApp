/**
 * =========================================================================
 * LIFE OPERATING SYSTEM
 * =========================================================================
 * A single-file Apps Script. Drop this into the script editor of a fresh
 * Google Sheet, replace the manifest with the provided appsscript.json,
 * reload the spreadsheet, then:
 *
 *   1. Life OS menu -> Run setup           // builds every tab + the dashboard
 *   2. Accept the wizard offer             // fills User_Profile + API key
 *   3. Use the Dashboard tab               // checkbox "buttons" run actions
 *   4. (Optional) add time-based triggers  // runDailyAudit, runSpiritualReport, ...
 *
 * Everything user-specific lives in spreadsheet tabs (User_Profile and
 * System_Docs). Code is generic; secrets live in Script Properties.
 * =========================================================================
 */


/* =========================================================================
 * SECTION 1 — CONSTANTS
 * Tab names and the Script-Properties key. The only "magic strings" the
 * system enforces; the bootstrapper creates these tabs on first run.
 * ========================================================================= */

const TAB_DASHBOARD   = 'Dashboard';
const TAB_RESPONSES   = 'Responses';
const TAB_USER_PROF   = 'User_Profile';
const TAB_USER_MEM    = 'User_Memory';
const TAB_SYS_DOCS    = 'System_Docs';
const TAB_SPIRIT_BIO  = 'Spiritual_Biography';
const TAB_LIBRARY     = 'Habit_Library';

const PROP_API_KEY    = 'GEMINI_API_KEY';

const SPIRIT_DELIM_REPORT = '===SPIRITUAL_REPORT===';
const SPIRIT_DELIM_BIO    = '===BIOGRAPHY_ENTRY===';
const SPIRIT_DELIM_END    = '===END===';


/* =========================================================================
 * SECTION 2 — TRIGGER ENTRY POINTS
 * Bind these to time-based triggers in the Apps Script editor.
 * ========================================================================= */

function runDailyAudit()       { processReport('DAILY', 1); }
function runWeeklyReport()     { processReport('WEEKLY', 7); }
function runMonthlyReview()    { processReport('MONTHLY', 30); }
function runAnnualReview()     { processReport('ANNUAL', 365); }
function runSpiritualReport()  { processSpiritualReport(profileGetInt('spiritual_lookback_days', 14)); }


/**
 * Adds a "Life OS" menu to the spreadsheet so users can run setup, set
 * the API key, and trigger reports without opening the script editor.
 * Runs automatically every time the spreadsheet is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Life OS')
    .addItem('Run setup',                'setupSpreadsheet')
    .addItem('Edit profile…',            'runProfileWizard')
    .addItem('Set Gemini API key…',      'setApiKey')
    .addItem('Refresh dashboard',        'refreshDashboard')
    .addSeparator()
    .addItem('Sync schema → Responses',  'syncSchemaToResponses')
    .addItem('Pull Responses → Schema',  'pullResponsesIntoSchema')
    .addItem('Import library selections','importLibrarySelections')
    .addItem('Reformat Responses table', 'formatResponsesNow')
    .addSeparator()
    .addItem('Run daily audit',          'runDailyAudit')
    .addItem('Run weekly report',        'runWeeklyReport')
    .addItem('Run monthly review',       'runMonthlyReview')
    .addItem('Run annual review',        'runAnnualReview')
    .addItem('Run spiritual report',     'runSpiritualReport')
    .addToUi();

  // Refresh dashboard status panel on every open so it stays accurate.
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && ss.getSheetByName(TAB_DASHBOARD)) refreshDashboard();
  } catch (e) { /* dashboard not built yet — no-op */ }
}


/* =========================================================================
 * SECTION 3 — SETUP
 * One-time bootstrappers. Idempotent: safe to re-run; never clobbers user
 * edits on existing rows.
 * ========================================================================= */

/**
 * Master setup. Run this once after pasting the script in. Creates every
 * required tab and seeds defaults for User_Profile and System_Docs.
 */
function setupSpreadsheet() {
  const ss = getSpreadsheet_();
  const profileExisted = !!ss.getSheetByName(TAB_USER_PROF);

  ensureTab_(ss, TAB_RESPONSES,  [DEFAULT_RESPONSES_HEADERS]);
  ensureTab_(ss, TAB_USER_PROF,  DEFAULT_PROFILE);
  ensureTab_(ss, TAB_USER_MEM,   [['id', 'timestamp', 'type', 'content']]);
  ensureTab_(ss, TAB_SYS_DOCS,   getDefaultDocs_());
  ensureTab_(ss, TAB_SPIRIT_BIO, [['date', 'type', 'title', 'narrative', 'tags']]);
  ensureLibraryTab_(ss);

  // Format Responses as a banded table with frozen header + habit
  // dropdown validation. Safe on first run (empty sheet) and on
  // re-runs (idempotent).
  formatResponsesTable_(ss.getSheetByName(TAB_RESPONSES));

  buildDashboard_(ss);
  ensureDashboardEditTrigger_();

  // Make the Dashboard the first sheet so users land on it.
  const dash = ss.getSheetByName(TAB_DASHBOARD);
  if (dash) {
    ss.setActiveSheet(dash);
    ss.moveActiveSheet(1);
  }

  let ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  if (!ui) return;

  // Offer to open the profile editor for first-time users.
  if (!profileExisted || !profileGet('email', '')) {
    const resp = ui.alert(
      'Life OS is set up',
      'Open your profile now? You can fill in email, timezone, location, faith, career, goals, your spiritual context, and your Gemini API key. The same dialog can be re-opened any time to update individual fields.',
      ui.ButtonSet.YES_NO
    );
    if (resp === ui.Button.YES) {
      runProfileWizard();
      return;
    }
  }

  ui.alert(
    'Life OS is set up.\n\n' +
    '• Open the Dashboard tab.\n' +
    '• Edit the Schema region (or tick items on Habit_Library + click "Import selected from library").\n' +
    '• Click "Sync schema to Responses" to apply.\n' +
    '• Click "Edit profile" any time to update your saved profile fields.'
  );
}


/**
 * Profile editor, served as an HtmlService modal dialog.
 *
 * This is the home for User_Profile. Run it the first time to set
 * everything up, and re-run it any time to update individual fields.
 * Existing values are loaded into the form so it functions as a
 * profile editor rather than a one-time wizard.
 */
function runProfileWizard() {
  let ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) {
    throw new Error('runProfileWizard must be invoked from the spreadsheet, not the script editor.');
  }

  const ss = getSpreadsheet_();
  if (!ss.getSheetByName(TAB_USER_PROF)) setupSpreadsheet();

  const html = HtmlService.createHtmlOutput(buildWizardHtml_())
    .setWidth(680)
    .setHeight(720);
  ui.showModalDialog(html, 'Life OS — Profile');
}

/**
 * Backward-compatible alias for any existing triggers, menu bindings,
 * or muscle memory pointing at the old name.
 */
function runInitWizard() { return runProfileWizard(); }


/**
 * NOTE: the next two functions are intentionally PUBLIC (no trailing
 * underscore). Apps Script blocks google.script.run from calling
 * server functions whose names end in '_'. The wizard dialog calls
 * both via google.script.run, so they must be public.
 */

/** Returns the current wizard state for prefilling the dialog. */
function wizardLoad() {
  // Tolerate a missing User_Profile tab (e.g. if the user opened the
  // dialog before running setup): bootstrap on demand and continue.
  try { getProfile(); } catch (e) { setupSpreadsheet(); }

  const email    = profileGet('email', '');
  const tz       = profileGet('timezone', '');
  const location = profileGet('location', '');
  const faith    = profileGet('faith', '');
  const career   = profileGet('career', '');
  const goals    = profileGet('goals', '');
  const sctx     = profileGet('spiritual_context', '');

  // "isExisting" is true if the user has saved at least one of the
  // profile fields previously. The dialog uses it to decide between
  // "Edit profile" and "Set up profile" framing.
  const isExisting = !!(email || tz || location || faith || career || goals || sctx);

  return {
    email:             email,
    timezone:          tz || (Session.getScriptTimeZone && Session.getScriptTimeZone()) || 'America/New_York',
    location:          location,
    faith:             faith,
    career:            career,
    goals:             goals,
    spiritual_context: sctx,
    apiKeySet:         !!PropertiesService.getScriptProperties().getProperty(PROP_API_KEY),
    timezoneOptions:   TIMEZONE_OPTIONS,
    isExisting:        isExisting
  };
}

/** Persists wizard answers and (optionally) the API key. */
function wizardSubmit(answers) {
  const fields = ['email', 'timezone', 'location', 'faith', 'career', 'goals', 'spiritual_context'];
  fields.forEach(k => {
    const v = (answers && answers[k] != null) ? String(answers[k]).trim() : '';
    if (v) profileSet_(k, v);
  });

  const props = PropertiesService.getScriptProperties();
  if (answers && answers.apiKey) {
    const k = String(answers.apiKey).trim();
    if (k) props.setProperty(PROP_API_KEY, k);
  }

  try { refreshDashboard(); } catch (e) { /* dashboard may not exist yet */ }

  const finalKey = !!props.getProperty(PROP_API_KEY);
  return 'User_Profile saved. Gemini API key: ' + (finalKey ? '✓ stored' : '✗ not set');
}


/**
 * Curated list of IANA timezones offered by the wizard's dropdown.
 * Grouped to keep the menu navigable; users who need a zone we didn't
 * include can still type it directly into User_Profile.
 */
const TIMEZONE_OPTIONS = [
  { group: 'UTC',           zones: ['UTC'] },
  { group: 'Americas',      zones: [
    'America/Anchorage', 'America/Los_Angeles', 'America/Vancouver',
    'America/Denver', 'America/Phoenix', 'America/Edmonton',
    'America/Chicago', 'America/Mexico_City', 'America/Winnipeg',
    'America/New_York', 'America/Toronto', 'America/Indiana/Indianapolis',
    'America/Halifax', 'America/St_Johns',
    'America/Bogota', 'America/Lima', 'America/Caracas',
    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
    'America/Santiago', 'America/Honolulu'
  ] },
  { group: 'Europe',        zones: [
    'Europe/London', 'Europe/Dublin', 'Europe/Lisbon',
    'Europe/Paris', 'Europe/Madrid', 'Europe/Brussels',
    'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Zurich',
    'Europe/Rome', 'Europe/Vienna', 'Europe/Warsaw',
    'Europe/Stockholm', 'Europe/Helsinki', 'Europe/Athens',
    'Europe/Bucharest', 'Europe/Istanbul', 'Europe/Moscow'
  ] },
  { group: 'Africa',        zones: [
    'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo',
    'Africa/Nairobi', 'Africa/Johannesburg'
  ] },
  { group: 'Middle East',   zones: [
    'Asia/Jerusalem', 'Asia/Beirut', 'Asia/Riyadh',
    'Asia/Dubai', 'Asia/Tehran'
  ] },
  { group: 'Asia',          zones: [
    'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kathmandu',
    'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta',
    'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Manila',
    'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo'
  ] },
  { group: 'Oceania',       zones: [
    'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
  ] }
];


function buildWizardHtml_() {
  // Build the timezone <optgroup> markup server-side — keeps the
  // client script small and avoids escaping headaches.
  const tzGroups = TIMEZONE_OPTIONS.map(g => {
    const opts = g.zones.map(z => '<option value="' + z + '">' + z + '</option>').join('');
    return '<optgroup label="' + g.group + '">' + opts + '</optgroup>';
  }).join('');

  return `<!DOCTYPE html>
<html><head><base target="_top"><style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, sans-serif; color: #222; background: #fafafa; }
  .wrap { padding: 22px 26px 110px; max-width: 620px; margin: 0 auto; }
  h2 { margin: 0 0 4px; }
  p.lead { color: #555; margin: 0 0 18px; font-size: 13px; }
  fieldset { border: 1px solid #e3e3e3; background: #fff; border-radius: 8px; padding: 14px 16px; margin: 0 0 14px; }
  legend { font-weight: 600; padding: 0 6px; font-size: 14px; color: #8e44ad; }
  label { display: block; font-size: 13px; color: #555; margin: 0 0 4px; }
  textarea, input[type=text], select {
    width: 100%; box-sizing: border-box; padding: 9px 10px;
    font-family: inherit; font-size: 14px;
    border: 1px solid #ccc; border-radius: 6px; background: #fff;
  }
  textarea { min-height: 80px; resize: vertical; }
  .req { color: #c0392b; }
  .help { font-size: 12px; color: #777; margin: 4px 0 0; }
  .footer {
    position: fixed; left: 0; right: 0; bottom: 0;
    background: #fff; border-top: 1px solid #e3e3e3;
    padding: 12px 26px; display: flex; align-items: center; gap: 10px;
  }
  button {
    padding: 9px 16px; font-size: 14px; border: 1px solid #888;
    background: #fff; border-radius: 6px; cursor: pointer;
  }
  button.primary { background: #8e44ad; color: #fff; border-color: #8e44ad; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { flex: 1; font-size: 13px; color: #444; }
  .ok { color: #2c7a3a; }
  .err { color: #c0392b; }
</style></head><body>
<div class="wrap">
  <h2 id="title">Life OS — Profile</h2>
  <p class="lead" id="lead">Loading…</p>

  <fieldset>
    <legend>Identity</legend>
    <label for="email">Email address <span class="req">*</span></label>
    <input type="text" id="email" autocomplete="off" />
    <p class="help">Where reports will be sent.</p>

    <label for="timezone" style="margin-top:12px">Timezone</label>
    <select id="timezone">${tzGroups}</select>
    <p class="help">Pick the closest IANA zone. If your zone isn't listed, you can still type it directly into User_Profile after saving.</p>

    <label for="location" style="margin-top:12px">Location</label>
    <input type="text" id="location" autocomplete="off" />
    <p class="help">City / region. Used to ground prompts in local context.</p>
  </fieldset>

  <fieldset>
    <legend>Life context</legend>
    <label for="faith">Faith tradition (optional)</label>
    <textarea id="faith"></textarea>
    <p class="help">Used by the spiritual subsystem. Leave blank if not applicable.</p>

    <label for="career" style="margin-top:12px">Career / studies (optional)</label>
    <textarea id="career"></textarea>
    <p class="help">Current role, schooling, transitions. Used in prompts.</p>

    <label for="goals" style="margin-top:12px">Current goals (optional)</label>
    <textarea id="goals"></textarea>
    <p class="help">A short list — comma-separated or one per line.</p>
  </fieldset>

  <fieldset>
    <legend>Spiritual context (optional)</legend>
    <label for="spiritual_context">Your spiritual situation, goals, and rule of life</label>
    <textarea id="spiritual_context" style="min-height:140px"></textarea>
    <p class="help">Free-form. Anything you'd want a spiritual director to know — tradition, current rule of prayer, fasting practice, struggles, what season you're in. The spiritual report appends this to its prompt as authoritative framing, so update it whenever your situation shifts.</p>
  </fieldset>

  <fieldset>
    <legend>Gemini API key</legend>
    <label for="apiKey">API key</label>
    <input type="text" id="apiKey" autocomplete="off" placeholder="" />
    <p class="help" id="keyHelp">Stored privately in Script Properties. Get a key at https://aistudio.google.com/app/apikey</p>
  </fieldset>
</div>

<div class="footer">
  <span class="status" id="status">Loading…</span>
  <button id="cancel">Close</button>
  <button id="save" class="primary" disabled>Save</button>
</div>

<script>
function val(id) { return document.getElementById(id).value; }
function set(id, v) { document.getElementById(id).value = v == null ? '' : v; }
function setStatus(msg, cls) {
  var s = document.getElementById('status');
  s.textContent = msg || '';
  s.className = 'status' + (cls ? ' ' + cls : '');
}

google.script.run
  .withSuccessHandler(function(loaded) {
    set('email',             loaded.email);
    set('location',          loaded.location);
    set('faith',             loaded.faith);
    set('career',            loaded.career);
    set('goals',             loaded.goals);
    set('spiritual_context', loaded.spiritual_context);

    // Timezone: pick the loaded value if present in the dropdown,
    // otherwise insert it at the top so the user's saved value is
    // always preserved.
    var tz = document.getElementById('timezone');
    var want = loaded.timezone || '';
    var found = false;
    for (var i = 0; i < tz.options.length; i++) {
      if (tz.options[i].value === want) { tz.selectedIndex = i; found = true; break; }
    }
    if (!found && want) {
      var opt = document.createElement('option');
      opt.value = want; opt.textContent = want + ' (current)';
      tz.insertBefore(opt, tz.firstChild);
      tz.selectedIndex = 0;
    }

    if (loaded.apiKeySet) {
      document.getElementById('apiKey').placeholder = 'A key is already stored — leave blank to keep it';
      document.getElementById('keyHelp').innerHTML =
        '<span class="ok">A key is already stored.</span> Paste a new one to replace it, or leave blank to keep the existing key.';
    }

    // Re-frame the dialog based on whether this is first-time setup
    // or an edit of an already-populated profile.
    var lead = document.getElementById('lead');
    if (loaded.isExisting) {
      document.getElementById('title').textContent = 'Life OS — Edit profile';
      lead.innerHTML = '<span class="ok">Loaded your saved profile.</span> Update any field; blank fields are kept as-is. Email is required.';
    } else {
      document.getElementById('title').textContent = 'Life OS — Profile setup';
      lead.textContent = 'Fill in what you know. Everything except email is optional, and you can re-open this any time to update individual fields.';
    }

    document.getElementById('save').disabled = false;
    setStatus('');
  })
  .withFailureHandler(function(err) {
    setStatus('Could not load profile: ' + err.message, 'err');
  })
  .wizardLoad();

document.getElementById('cancel').onclick = function() { google.script.host.close(); };

document.getElementById('save').onclick = function() {
  var email = val('email').trim();
  if (!email) {
    setStatus('Email is required.', 'err');
    document.getElementById('email').focus();
    return;
  }
  document.getElementById('save').disabled = true;
  setStatus('Saving…');

  var answers = {
    email:             email,
    timezone:          val('timezone'),
    location:          val('location'),
    faith:             val('faith'),
    career:            val('career'),
    goals:             val('goals'),
    spiritual_context: val('spiritual_context'),
    apiKey:            val('apiKey')
  };

  google.script.run
    .withSuccessHandler(function(msg) {
      setStatus(msg + ' — closing…', 'ok');
      setTimeout(function(){ google.script.host.close(); }, 1100);
    })
    .withFailureHandler(function(err) {
      setStatus('Error: ' + err.message, 'err');
      document.getElementById('save').disabled = false;
    })
    .wizardSubmit(answers);
};
</script>
</body></html>`;
}


/* =========================================================================
 * SECTION 3b — DASHBOARD
 * Builds a clickable home page with checkbox "buttons" and a live status
 * panel. An installable onEdit trigger watches the checkbox cells; when
 * one is checked, the matching action runs and the box resets to FALSE.
 * ========================================================================= */

const DASHBOARD_ACTIONS = [
  // Setup & identity
  { label: 'Edit profile',               fn: 'runProfileWizard',
    note:  'Opens a dialog prefilled with your saved User_Profile values. Edit any field, save.' },
  { label: 'Set Gemini API key',         fn: 'setApiKey',
    note:  'Opens a prompt. Stored privately in Script Properties.' },
  { label: 'Re-run setup',               fn: 'setupSpreadsheet',
    note:  'Recreates missing tabs and tops up any new defaults.' },

  // Schema management — declarative, edited in the Schema region below
  { label: 'Sync schema to Responses',   fn: 'syncSchemaToResponses',
    note:  'Adds any new rows in the Schema region as columns; removes columns that no longer appear.' },
  { label: 'Pull Responses into Schema', fn: 'pullResponsesIntoSchema',
    note:  'Rewrites the Schema region from whatever columns currently exist on Responses.' },
  { label: 'Import selected from library', fn: 'importLibrarySelections',
    note:  'Copies ticked rows from the Habit_Library tab into the Schema region.' },
  { label: 'Reformat Responses table',   fn: 'formatResponsesNow',
    note:  'Re-applies banding, frozen header, Success/Fail/Exempt validation, and LongText sample seeding for AppSheet.' },

  // Manual report triggers
  { label: 'Run daily audit now',        fn: 'runDailyAudit',
    note:  'Generates today\'s briefing and emails it.' },
  { label: 'Run weekly report now',      fn: 'runWeeklyReport',
    note:  'Strategy review of the last 7 days.' },
  { label: 'Run monthly review now',     fn: 'runMonthlyReview',
    note:  'Performance grade for the last 30 days.' },
  { label: 'Run annual review now',      fn: 'runAnnualReview',
    note:  'Year-in-review narrative.' },
  { label: 'Run spiritual report now',   fn: 'runSpiritualReport',
    note:  'Pastoral review and biography chapter.' },

  { label: 'Refresh dashboard status',   fn: 'refreshDashboard',
    note:  'Re-reads User_Profile and the sheets to update the panel below.' }
];

// Layout constants. The dashboard is divided into three regions, each
// anchored by a constant so the rest of the code can address rows
// without recomputing offsets.
const DASH_ACTION_HEADER_ROW = 3;   // "Actions" header
const DASH_ACTION_START_ROW  = 4;   // first action checkbox
const DASH_STATUS_BLANK_ROWS = 2;   // gap between Actions and Status
const DASH_SCHEMA_GAP_ROWS   = 2;   // gap between Status and Schema
const DASH_SCHEMA_BLANK_ROWS = 8;   // blank slots appended after preserved schema rows
// (Schema and Status header rows are computed at build time and stored
// in DocumentProperties so the rest of the code can find them later.)

// Row 1 of the schema region holds the column header for the editable
// table; row 2..N are the data rows. Schema columns:
//   B = Type   ('Context' | 'Habit'),  validated dropdown
//   C = Name   (e.g. Journal, JesusPrayer, ReadDaily)
//   D = Description (free text, used by the library and human readers)

function buildDashboard_(ss) {
  let sh = ss.getSheetByName(TAB_DASHBOARD);
  if (!sh) sh = ss.insertSheet(TAB_DASHBOARD, 0);

  // Snapshot any user-edited schema before clearing so we never lose
  // the user's habit list when re-running setup.
  const preservedSchema = readDashboardSchema_(sh);

  sh.clear();
  sh.clearConditionalFormatRules();
  // sh.clear() preserves merges; break them so re-layout doesn't compound.
  if (sh.getMaxRows() > 0 && sh.getMaxColumns() > 0) {
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  }
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 30);    // checkbox
  sh.setColumnWidth(2, 200);   // label / Type
  sh.setColumnWidth(3, 280);   // note / Name / Status value
  sh.setColumnWidth(4, 360);   // Description (schema) / overflow

  // Layout (top → bottom):
  //   Title (rows 1–2)
  //   Actions
  //   Status   ← fixed-height
  //   Schema   ← grows downward, last region on the sheet so it can
  //              expand without cutting into anything else.

  // ---- Title ----
  sh.getRange('B1').setValue('Life OS').setFontSize(22).setFontWeight('bold');
  sh.getRange('B2').setValue('Tick a checkbox to run an action. Schema region at the bottom — edit it, then click "Sync schema to Responses".')
                   .setFontStyle('italic').setFontColor('#555');
  sh.getRange('A1:D2').setBackground('#f5f1fa');

  // ---- Actions ----
  sh.getRange(DASH_ACTION_HEADER_ROW, 2).setValue('Actions').setFontWeight('bold').setFontSize(14);
  DASHBOARD_ACTIONS.forEach((a, i) => {
    const row = DASH_ACTION_START_ROW + i;
    const cb = sh.getRange(row, 1);
    cb.insertCheckboxes();
    cb.setValue(false);
    sh.getRange(row, 2).setValue(a.label).setFontWeight('bold');
    sh.getRange(row, 3).setValue(a.note).setFontColor('#666');
  });

  // ---- Status (between actions and schema) ----
  const statusRow = DASH_ACTION_START_ROW + DASHBOARD_ACTIONS.length + DASH_STATUS_BLANK_ROWS;
  sh.getRange(statusRow, 2).setValue('Status').setFontWeight('bold').setFontSize(14);
  STATUS_LABELS.forEach((label, i) => {
    sh.getRange(statusRow + 1 + i, 2).setValue(label).setFontWeight('bold');
  });
  PropertiesService.getDocumentProperties().setProperty('DASH_STATUS_HEADER_ROW', String(statusRow));

  // ---- Schema (last region — extends downward freely) ----
  const schemaHeaderRow = statusRow + 1 + STATUS_LABELS.length + DASH_SCHEMA_GAP_ROWS;
  sh.getRange(schemaHeaderRow, 2).setValue('Schema (edit me, then click "Sync schema to Responses")').setFontWeight('bold').setFontSize(14);
  sh.getRange(schemaHeaderRow, 2, 1, 3).setBackground('#f5f1fa');
  sh.getRange(schemaHeaderRow + 1, 2, 1, 3).setValues([['Type', 'Name', 'Description']])
    .setFontWeight('bold').setBackground('#eee');

  // Fallback chain for what to put in the Schema region:
  //   1. The user-edited schema we just snapshotted.
  //   2. Whatever columns currently exist on Responses (so the
  //      Schema is always a true mirror of the live schema).
  //   3. The bare-bones DEFAULT_SCHEMA_SEED (first run only).
  let seedRows = (preservedSchema && preservedSchema.length > 0) ? preservedSchema : null;
  if (!seedRows) {
    const fromResponses = readSchemaFromResponses_(ss);
    seedRows = fromResponses.length > 0 ? fromResponses : DEFAULT_SCHEMA_SEED;
  }

  const schemaDataStart = schemaHeaderRow + 2;
  if (seedRows.length > 0) {
    sh.getRange(schemaDataStart, 2, seedRows.length, 3).setValues(seedRows);
  }
  const blanks = [];
  for (let i = 0; i < DASH_SCHEMA_BLANK_ROWS; i++) blanks.push(['', '', '']);
  if (blanks.length) {
    sh.getRange(schemaDataStart + seedRows.length, 2, blanks.length, 3).setValues(blanks);
  }
  const totalSlots = seedRows.length + blanks.length;

  // Type dropdown across the whole schema region. Apply it to a
  // generous range below the seeded rows too, so when the user types
  // into a blank row the Type cell already has the dropdown.
  const ruleRows = Math.max(totalSlots, 200);
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Context', 'Habit'], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(schemaDataStart, 2, ruleRows, 1).setDataValidation(typeRule);

  PropertiesService.getDocumentProperties().setProperty('DASH_SCHEMA_HEADER_ROW', String(schemaHeaderRow));

  refreshDashboard();
}

// Status panel labels — defined once so buildDashboard_ and
// refreshDashboard agree on layout.
const STATUS_LABELS = [
  'Email', 'Timezone', 'Location', 'Faith', 'Career', 'Goals',
  'Spiritual context', 'Gemini API key', 'Model',
  'Responses rows', 'Latest daily score',
  'Biography chapters', 'Last memory entry'
];

/**
 * Reads the editable schema region on the Dashboard, returning rows of
 * [type, name, description] with empties skipped. Returns [] if the
 * Dashboard isn't set up yet or the region can't be located.
 */
function readDashboardSchema_(sh) {
  if (!sh) return [];
  const props = PropertiesService.getDocumentProperties();
  const headerRow = parseInt(props.getProperty('DASH_SCHEMA_HEADER_ROW') || '0', 10);
  if (!headerRow) return [];
  const dataStart = headerRow + 2;
  const lastRow = sh.getLastRow();
  if (lastRow < dataStart) return [];

  // Schema is the last region on the sheet, so we read all the way to
  // the end. Empty rows are skipped.
  const numRows = lastRow - dataStart + 1;
  if (numRows <= 0) return [];

  const values = sh.getRange(dataStart, 2, numRows, 3).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const type = String(values[i][0] || '').trim();
    const name = String(values[i][1] || '').trim();
    const desc = String(values[i][2] || '').trim();
    if (!name) continue;
    out.push([type || 'Habit', name, desc]);
  }
  return out;
}

/**
 * Re-reads User_Profile and the relevant sheets, and writes a status
 * snapshot into the Dashboard's status panel. Safe to call any time.
 */
function refreshDashboard() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_DASHBOARD);
  if (!sh) return;

  const statusHeaderRow = parseInt(
    PropertiesService.getDocumentProperties().getProperty('DASH_STATUS_HEADER_ROW') || '0', 10);
  if (!statusHeaderRow) return;

  const profile = (function () {
    try { return getProfile(); } catch (e) { return {}; }
  })();
  const apiKeySet = !!PropertiesService.getScriptProperties().getProperty(PROP_API_KEY);

  const responsesSheet = ss.getSheetByName(TAB_RESPONSES);
  const memSheet = ss.getSheetByName(TAB_USER_MEM);
  const bioSheet = ss.getSheetByName(TAB_SPIRIT_BIO);

  let respRows = 0, latestScore = '—';
  if (responsesSheet) {
    respRows = Math.max(0, responsesSheet.getLastRow() - 1);
    if (respRows > 0 && responsesSheet.getLastColumn() > 0) {
      const headers = responsesSheet.getRange(1, 1, 1, responsesSheet.getLastColumn()).getValues()[0];
      const scoreCol = headers.indexOf(profile.col_score || 'Daily_Score');
      if (scoreCol > -1) {
        const v = responsesSheet.getRange(responsesSheet.getLastRow(), scoreCol + 1).getValue();
        if (v !== '' && v !== null && v !== undefined) latestScore = v;
      }
    }
  }
  const bioRows = bioSheet ? Math.max(0, bioSheet.getLastRow() - 1) : 0;

  let lastMemoryLabel = '—';
  if (memSheet && memSheet.getLastRow() > 1) {
    const last = memSheet.getRange(memSheet.getLastRow(), 1, 1, 3).getValues()[0];
    const ts = last[1] instanceof Date ? Utilities.formatDate(last[1], profile.timezone || 'UTC', 'yyyy-MM-dd HH:mm') : last[1];
    lastMemoryLabel = `${last[2] || ''} @ ${ts}`;
  }

  const values = [
    [profile.email     || '(not set)'],
    [profile.timezone  || '(not set)'],
    [profile.location  || '(not set)'],
    [profile.faith     || '(not set)'],
    [profile.career    || '(not set)'],
    [profile.goals     || '(not set)'],
    [profile.spiritual_context ? truncate_(profile.spiritual_context, 240) : '(not set)'],
    [apiKeySet ? '✓ stored in Script Properties' : '✗ not set — use the action above'],
    [profile.model_name || '(default)'],
    [respRows],
    [latestScore],
    [bioRows],
    [lastMemoryLabel]
  ];
  sh.getRange(statusHeaderRow + 1, 3, values.length, 1).setValues(values);
}

function truncate_(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}


/**
 * Installable onEdit trigger handler.
 *
 * Apps Script gives every spreadsheet a simple `onEdit(e)` trigger that
 * fires on edits — but simple triggers cannot send mail, call external
 * services, or use most permissions-requiring APIs. So we instead
 * register a real installable trigger that runs this handler with the
 * full authorization of the script owner.
 *
 * When the user ticks a checkbox in column A of the Dashboard's action
 * range, we look up the corresponding function name and invoke it,
 * then reset the checkbox to FALSE.
 */
function dashboardOnEdit_(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== TAB_DASHBOARD) return;
    if (e.range.getColumn() !== 1) return;
    const row = e.range.getRow();
    const idx = row - DASH_ACTION_START_ROW;
    if (idx < 0 || idx >= DASHBOARD_ACTIONS.length) return;
    if (e.value !== 'TRUE' && e.value !== true) return;

    const action = DASHBOARD_ACTIONS[idx];
    e.range.setValue(false);
    invokeAction_(action.fn);
    refreshDashboard();
  } catch (err) {
    Logger.log('dashboardOnEdit_ failure: ' + err);
    try {
      SpreadsheetApp.getUi().alert('Action failed: ' + err);
    } catch (e2) { /* no UI in this context */ }
  }
}

function invokeAction_(name) {
  const fn = (typeof globalThis !== 'undefined' ? globalThis : this)[name];
  if (typeof fn !== 'function') throw new Error(`Unknown action: ${name}`);
  fn();
}

/**
 * Ensures the dashboardOnEdit_ installable trigger exists. Idempotent.
 */
function ensureDashboardEditTrigger_() {
  const ss = getSpreadsheet_();
  const triggers = ScriptApp.getProjectTriggers();
  const already = triggers.some(t =>
    t.getHandlerFunction() === 'dashboardOnEdit_' &&
    t.getEventType() === ScriptApp.EventType.ON_EDIT
  );
  if (already) return;
  ScriptApp.newTrigger('dashboardOnEdit_').forSpreadsheet(ss).onEdit().create();
}

/* -------------------------------------------------------------------------
 * Schema management — Responses tab
 *
 * The Responses tab is divided by three markers from User_Profile:
 *   col_spacer  (default '>> HABITS >>')   – everything to the LEFT is context
 *   col_end     (default 'AI_Feedback_Log') – AI feedback column
 *   col_score   (default 'Daily_Score')     – numeric score column
 *
 * The functions below let users grow this schema from the Dashboard
 * without ever touching the header row by hand.
 * -----------------------------------------------------------------------*/

function getResponsesLayout_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_RESPONSES);
  if (!sh) throw new Error(`Missing '${TAB_RESPONSES}' tab. Run setup from the Dashboard.`);

  const profile = getProfile();
  const spacer = profile.col_spacer || '>> HABITS >>';
  const endCol = profile.col_end    || 'AI_Feedback_Log';
  const scoreCol = profile.col_score || 'Daily_Score';

  const lastCol = sh.getLastColumn();
  const headers = lastCol > 0
    ? sh.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];

  const idxSpacer = headers.indexOf(spacer);
  const idxEnd    = headers.indexOf(endCol);
  const idxScore  = headers.indexOf(scoreCol);

  if (idxSpacer === -1) {
    throw new Error(`Could not find the '${spacer}' marker on the Responses sheet. Re-run setup from the Dashboard.`);
  }
  if (idxEnd === -1) {
    throw new Error(`Could not find the '${endCol}' marker on the Responses sheet. Re-run setup from the Dashboard.`);
  }

  const reserved = new Set(['ID', 'Date', spacer, endCol, scoreCol, '_RowNumber']);
  const contextCols = [];
  const habitCols = [];
  for (let c = 0; c < idxSpacer; c++) {
    const h = String(headers[c] || '').trim();
    if (h && !reserved.has(h)) contextCols.push({ name: h, col: c + 1 });
  }
  for (let c = idxSpacer + 1; c < idxEnd; c++) {
    const h = String(headers[c] || '').trim();
    if (h && !reserved.has(h)) habitCols.push({ name: h, col: c + 1 });
  }

  return {
    sheet: sh,
    headers: headers,
    spacer: spacer,
    endCol: endCol,
    scoreCol: scoreCol,
    idxSpacer: idxSpacer,
    idxEnd: idxEnd,
    idxScore: idxScore,
    contextCols: contextCols,
    habitCols: habitCols
  };
}

/**
 * Reads the Schema region on the Dashboard, then makes the Responses
 * tab match it: any new column is inserted in the correct region
 * (context = left of spacer, habit = right of spacer); any column on
 * Responses that the user has removed from the schema is deleted.
 *
 * Rules:
 *   - Protected columns (ID, Date, spacer, end, score) are never
 *     touched.
 *   - The user is prompted to confirm deletions before any column is
 *     dropped (since this destroys data).
 */
function syncSchemaToResponses() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_DASHBOARD);
  if (!sh) { ui.alert('Run setup first.'); return; }

  const schema = readDashboardSchema_(sh);

  // Guardrail: if the Schema region is empty but Responses already has
  // columns, an empty-schema sync would propose deleting everything.
  // That is almost certainly a mistake (the user cleared the region by
  // accident, or never populated it). Offer to mirror Responses into
  // the Schema instead.
  if (schema.length === 0) {
    const layout = (function () {
      try { return getResponsesLayout_(); } catch (e) { return null; }
    })();
    const haveAny = layout && (layout.contextCols.length + layout.habitCols.length) > 0;
    if (haveAny) {
      const choice = ui.alert(
        'Schema is empty',
        'The Schema region on the Dashboard is empty, but the Responses tab already has columns. ' +
        'Syncing now would propose deleting all of them.\n\n' +
        'Click YES to refresh the Schema from Responses instead. Click NO to cancel.',
        ui.ButtonSet.YES_NO
      );
      if (choice === ui.Button.YES) pullResponsesIntoSchema();
      return;
    }
  }
  // Validate that every schema entry has a sensible type.
  const seen = new Set();
  const wantContext = [];
  const wantHabit = [];
  for (const r of schema) {
    const type = String(r[0]).toLowerCase();
    const name = r[1];
    if (seen.has(name)) {
      ui.alert('Duplicate name in Schema: "' + name + '". Each column must be unique.');
      return;
    }
    seen.add(name);
    if (type === 'context') wantContext.push(name);
    else if (type === 'habit') wantHabit.push(name);
    else {
      ui.alert('Row "' + name + '" has an unrecognised Type. Use the dropdown to pick Context or Habit.');
      return;
    }
  }

  const layout = getResponsesLayout_();
  const haveContext = layout.contextCols.map(c => c.name);
  const haveHabit   = layout.habitCols.map(c => c.name);

  const desiredAll = new Set(wantContext.concat(wantHabit));
  const toDeleteContext = layout.contextCols.filter(c => !desiredAll.has(c.name));
  const toDeleteHabit   = layout.habitCols  .filter(c => !desiredAll.has(c.name));
  const toDelete = toDeleteContext.concat(toDeleteHabit);

  const toAddContext = wantContext.filter(n => haveContext.indexOf(n) === -1);
  const toAddHabit   = wantHabit  .filter(n => haveHabit.indexOf(n) === -1);

  if (toAdd_summary(toAddContext, toAddHabit) === 0 && toDelete.length === 0) {
    ui.alert('Schema and Responses are already in sync.');
    return;
  }

  // Confirm before destructive changes.
  if (toDelete.length > 0) {
    const confirm = ui.alert(
      'Confirm column deletions',
      'These columns will be DELETED from the Responses tab (data lost):\n\n' +
      toDelete.map(c => '  • ' + c.name).join('\n') +
      (toAddContext.length + toAddHabit.length > 0
        ? '\n\nAnd these will be added:\n' +
          toAddContext.map(n => '  + ' + n + ' (context)').join('\n') +
          (toAddContext.length && toAddHabit.length ? '\n' : '') +
          toAddHabit  .map(n => '  + ' + n + ' (habit)').join('\n')
        : '') +
      '\n\nContinue?',
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;
  }

  // Delete first (in descending column order so indexes stay valid).
  toDelete.sort((a, b) => b.col - a.col).forEach(c => layout.sheet.deleteColumn(c.col));

  // Re-read the layout because deletions shifted columns.
  let live = getResponsesLayout_();

  toAddContext.forEach(name => {
    const insertAt = live.idxSpacer + 1; // 1-indexed: insert BEFORE spacer
    live.sheet.insertColumnBefore(insertAt);
    live.sheet.getRange(1, insertAt).setValue(name).setFontWeight('bold');
    live = getResponsesLayout_();
  });

  toAddHabit.forEach(name => {
    const insertAt = live.idxEnd + 1; // 1-indexed: insert BEFORE end marker
    live.sheet.insertColumnBefore(insertAt);
    live.sheet.getRange(1, insertAt).setValue(name).setFontWeight('bold');
    live = getResponsesLayout_();
  });

  // Apply Success/Fail/Exempt validation across every habit column
  // (over the full sheet, not just existing rows) and re-apply table
  // formatting so AppSheet sees a clean banded table region.
  formatResponsesTable_(live.sheet);

  refreshDashboard();
  ui.alert(
    'Schema synced',
    'Added: ' + (toAddContext.length + toAddHabit.length) +
    '   |   Removed: ' + toDelete.length +
    '\n\nResponses formatted as a table; habit columns now have a Success/Fail/Exempt dropdown.',
    ui.ButtonSet.OK
  );
}

function toAdd_summary(a, b) { return (a ? a.length : 0) + (b ? b.length : 0); }


/**
 * Public action: re-apply table formatting and habit-column data
 * validation on Responses. Safe to run any time. Idempotent.
 */
function formatResponsesNow() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_RESPONSES);
  if (!sh) { ui.alert('Run setup first.'); return; }
  formatResponsesTable_(sh);
  ui.alert(
    'Responses formatted',
    'Table banding, frozen header, and Success / Fail / Exempt validation on habit columns have been refreshed.',
    ui.ButtonSet.OK
  );
}


/**
 * Formats the Responses tab as a banded table with a frozen header
 * and applies Success/Fail/Exempt data validation across every habit
 * column for the full sheet (every row, including future rows).
 *
 * Rationale: AppSheet auto-detects column types. When a column has a
 * "value-in-list" validation rule, AppSheet picks Enum and uses the
 * list as the allowed values. Applying the rule to the whole column
 * (not just existing rows) ensures rows AppSheet adds later inherit
 * the rule, so the GUI keeps its enum dropdown.
 */
function formatResponsesTable_(sh) {
  if (!sh) return;
  const lastCol = sh.getLastColumn();
  const maxRow  = sh.getMaxRows();
  if (lastCol < 1 || maxRow < 2) return;

  // Frozen + styled header row.
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, lastCol)
    .setFontWeight('bold')
    .setBackground('#eef1f5')
    .setVerticalAlignment('middle');

  // Re-apply banding so it covers the whole column range. Drop any
  // existing bandings on the sheet first to avoid duplicates.
  sh.getBandings().forEach(b => b.remove());
  sh.getRange(1, 1, maxRow, lastCol)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY)
    .setHeaderRowColor('#eef1f5')
    .setFirstRowColor('#ffffff')
    .setSecondRowColor('#f7f7f7');

  // Habit-column validation across the entire column range.
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const profile = (function () {
    try { return getProfile(); } catch (e) { return {}; }
  })();
  const spacer = profile.col_spacer || '>> HABITS >>';
  const endCol = profile.col_end    || 'AI_Feedback_Log';
  const idxSpacer = headers.indexOf(spacer);
  const idxEnd    = headers.indexOf(endCol);
  if (idxSpacer === -1 || idxEnd === -1) return;

  const habitRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Success', 'Fail', 'Exempt'], true)
    .setAllowInvalid(true)  // tolerate TRUE/FALSE history without yelling
    .setHelpText('Pick Success, Fail, or Exempt.')
    .build();

  const dataRows = maxRow - 1;
  if (dataRows < 1) return;

  // Habit columns are between the spacer and the end marker. Indexes
  // from headers.indexOf are 0-based; sheet columns are 1-based, so
  // the first habit column is (idxSpacer + 2) and the last is idxEnd
  // (the end marker itself sits at idxEnd + 1).
  const firstHabit = idxSpacer + 2;
  const lastHabit  = idxEnd;
  for (let c = firstHabit; c <= lastHabit; c++) {
    sh.getRange(2, c, dataRows, 1).setDataValidation(habitRule);
  }

  // Seed each context column with multi-line "Sample\nText" so AppSheet's
  // type detection picks LongText (it samples cells; columns whose values
  // contain newlines are typed as LongText, others default to Text and
  // render as single-line inputs). We only write into row 2 of a column
  // that is otherwise completely empty, so user data is never touched.
  // ID and Date are excluded.
  const reservedHeaders = new Set(['ID', 'Date', '_RowNumber']);
  for (let c = 1; c <= idxSpacer; c++) { // 1-indexed; idxSpacer is 0-based, so this iterates left-of-spacer columns
    const header = String(headers[c - 1] || '').trim();
    if (!header || reservedHeaders.has(header) || header === spacer) continue;
    const colVals = sh.getRange(2, c, dataRows, 1).getValues();
    const allEmpty = colVals.every(r => r[0] === '' || r[0] === null);
    if (allEmpty) {
      sh.getRange(2, c).setValue('Sample\nText').setFontColor('#999');
    }
  }
}


/**
 * Reads the live columns on the Responses tab and returns them as
 * schema rows [[type, name, description], ...]. Used as a fallback
 * when the Dashboard's Schema region is empty, and exposed via the
 * "Pull Responses → Schema" action.
 *
 * Descriptions: when the column already exists in the Habit_Library,
 * we copy its description so the Schema row stays informative.
 */
function readSchemaFromResponses_(ss) {
  const dataSheet = ss.getSheetByName(TAB_RESPONSES);
  if (!dataSheet || dataSheet.getLastColumn() < 1) return [];

  const profile = (function () {
    try { return getProfile(); } catch (e) { return {}; }
  })();
  const spacer = profile.col_spacer || '>> HABITS >>';
  const endCol = profile.col_end    || 'AI_Feedback_Log';
  const scoreCol = profile.col_score || 'Daily_Score';

  const headers = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0];
  const idxSpacer = headers.indexOf(spacer);
  const idxEnd    = headers.indexOf(endCol);
  if (idxSpacer === -1 || idxEnd === -1) return [];

  // Build a name -> description map from the library.
  const lib = ss.getSheetByName(TAB_LIBRARY);
  const descByName = {};
  if (lib && lib.getLastRow() > 1) {
    const libRows = lib.getRange(2, 2, lib.getLastRow() - 1, 3).getValues();
    libRows.forEach(r => {
      const name = String(r[1] || '').trim();
      const desc = String(r[2] || '').trim();
      if (name) descByName[name] = desc;
    });
  }

  const reserved = new Set(['ID', 'Date', spacer, endCol, scoreCol, '_RowNumber']);
  const out = [];
  for (let c = 0; c < idxSpacer; c++) {
    const h = String(headers[c] || '').trim();
    if (!h || reserved.has(h)) continue;
    out.push(['Context', h, descByName[h] || '']);
  }
  for (let c = idxSpacer + 1; c < idxEnd; c++) {
    const h = String(headers[c] || '').trim();
    if (!h || reserved.has(h)) continue;
    out.push(['Habit', h, descByName[h] || '']);
  }
  return out;
}

/**
 * Public action: rewrites the Dashboard's Schema region from whatever
 * is currently on the Responses tab. Useful if the Schema region was
 * cleared, edited destructively, or got out of sync.
 */
function pullResponsesIntoSchema() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const dash = ss.getSheetByName(TAB_DASHBOARD);
  if (!dash) { ui.alert('Run setup first.'); return; }

  const live = readSchemaFromResponses_(ss);
  if (live.length === 0) {
    ui.alert('No context or habit columns found on Responses. Add some columns first, or run setup to seed defaults.');
    return;
  }

  // Locate the Schema region and rewrite it. Preserve dropdowns by
  // re-applying the type rule to the rewritten rows.
  const props = PropertiesService.getDocumentProperties();
  const headerRow = parseInt(props.getProperty('DASH_SCHEMA_HEADER_ROW') || '0', 10);
  if (!headerRow) { ui.alert('Schema region not found. Re-run setup.'); return; }
  const dataStart = headerRow + 2;

  // Clear anything currently in the schema region first.
  const lastRow = dash.getLastRow();
  if (lastRow >= dataStart) {
    dash.getRange(dataStart, 2, lastRow - dataStart + 1, 3).clearContent();
  }

  dash.getRange(dataStart, 2, live.length, 3).setValues(live);

  // Reapply the Type dropdown across the rewritten rows + spare blanks.
  const ruleRows = Math.max(live.length + DASH_SCHEMA_BLANK_ROWS, 50);
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Context', 'Habit'], true)
    .setAllowInvalid(false)
    .build();
  dash.getRange(dataStart, 2, ruleRows, 1).setDataValidation(typeRule);

  refreshDashboard();
  ui.alert(
    'Schema refreshed',
    'Loaded ' + live.length + ' column' + (live.length === 1 ? '' : 's') +
    ' from the Responses tab into the Schema region.',
    ui.ButtonSet.OK
  );
}


/**
 * Reads the Habit_Library tab and copies any rows whose checkbox is
 * ticked into the Dashboard's Schema region (skipping any that are
 * already there). The library checkboxes are reset so they're ready
 * for the next round.
 *
 * The library is just a regular sheet — users can add/remove their
 * own rows any time.
 */
function importLibrarySelections() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet_();
  const lib = ss.getSheetByName(TAB_LIBRARY);
  const dash = ss.getSheetByName(TAB_DASHBOARD);
  if (!lib || !dash) { ui.alert('Run setup first.'); return; }

  const libRows = lib.getDataRange().getValues();
  if (libRows.length < 2) { ui.alert('The Habit_Library is empty.'); return; }

  // Header layout: A=Select, B=Type, C=Name, D=Description.
  const ticked = [];
  for (let i = 1; i < libRows.length; i++) {
    const sel = libRows[i][0];
    if (sel === true || sel === 'TRUE') {
      const type = String(libRows[i][1] || '').trim();
      const name = String(libRows[i][2] || '').trim();
      const desc = String(libRows[i][3] || '').trim();
      if (name) ticked.push({ type: type || 'Habit', name: name, desc: desc, row: i + 1 });
    }
  }
  if (ticked.length === 0) { ui.alert('No items ticked in Habit_Library.'); return; }

  // Read current schema, dedupe.
  const current = readDashboardSchema_(dash);
  const have = new Set(current.map(r => r[1]));
  const toAdd = ticked.filter(t => !have.has(t.name));
  if (toAdd.length === 0) {
    ui.alert('Every ticked item is already in your Schema.');
    return;
  }

  const props = PropertiesService.getDocumentProperties();
  const headerRow = parseInt(props.getProperty('DASH_SCHEMA_HEADER_ROW') || '0', 10);
  if (!headerRow) { ui.alert('Schema region not found. Re-run setup.'); return; }
  const dataStart = headerRow + 2;

  // Schema is the last region on the sheet — append after the last
  // populated row, or at dataStart if the region is empty.
  const lastRow = dash.getLastRow();
  let writeRow = lastRow >= dataStart
    ? Math.max(dataStart + current.length, dataStart)
    : dataStart;
  if (lastRow >= dataStart) {
    const scan = dash.getRange(dataStart, 2, lastRow - dataStart + 1, 3).getValues();
    for (let i = 0; i < scan.length; i++) {
      if (!String(scan[i][1] || '').trim()) { writeRow = dataStart + i; break; }
    }
  }

  const out = toAdd.map(t => [t.type, t.name, t.desc]);
  dash.getRange(writeRow, 2, out.length, 3).setValues(out);

  // Make sure Type cells in the newly-written rows have the dropdown.
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Context', 'Habit'], true)
    .setAllowInvalid(false)
    .build();
  dash.getRange(writeRow, 2, out.length, 1).setDataValidation(typeRule);

  // Reset the checkboxes we just consumed.
  ticked.forEach(t => lib.getRange(t.row, 1).setValue(false));

  refreshDashboard();
  ui.alert(
    'Imported ' + toAdd.length + ' item' + (toAdd.length === 1 ? '' : 's') + ' into the Schema.',
    'Click "Sync schema to Responses" when you\'re ready to apply your changes.',
    ui.ButtonSet.OK
  );
}


/* -------------------------------------------------------------------------
 * Schema seed and Habit_Library
 *
 * DEFAULT_SCHEMA_SEED is what the Dashboard's editable schema region
 * shows on a brand-new spreadsheet. We keep it minimal — just Journal —
 * so the user composes their real list either by typing rows or by
 * ticking entries in the Habit_Library and clicking
 * "Import selected from library".
 *
 * DEFAULT_LIBRARY is the curated catalog of common context columns and
 * habits, all phrased positively (success = the habit was kept).
 * -----------------------------------------------------------------------*/

const DEFAULT_SCHEMA_SEED = [
  ['Context', 'Journal', 'Free-text reflection. Internal dispositions, mood, what stood out today.']
];

const DEFAULT_LIBRARY = [
  // Context columns
  ['Context', 'Spiritual Life',      'Spiritual life: gospel readings, lives of saints, parish events, notable moments.'],
  ['Context', 'Exercise',            'What movement happened today (run, lift, walk, mobility).'],
  ['Context', 'Financial',           'Notable spending, earning, budgeting, or financial decisions.'],
  ['Context', 'Work',                'Work / study output, meetings, projects worked on.'],
  ['Context', 'Social',              'People you spent time with, conversations of note.'],
  ['Context', 'Reading',             'What you read today (books, articles, scripture).'],
  ['Context', 'Gratitude',           'Three things to be grateful for today.'],
  ['Context', 'Tomorrow',            'One sentence: the most important thing for tomorrow.'],

  // Habits — wellbeing & body
  ['Habit',   'Slept by midnight',     'Lights out before midnight.'],
  ['Habit',   'Woke on first alarm',   'Got up the first time the alarm rang — no snooze.'],
  ['Habit',   'Drank water',           'Hit your daily water target.'],
  ['Habit',   'Ate clean',             'No junk food / kept within your eating plan.'],
  ['Habit',   'Tracked calories',      'Logged food intake.'],
  ['Habit',   'Exercised',             'Completed today\'s workout.'],
  ['Habit',   'Stretched / mobility',  '10+ minutes of mobility or stretching.'],
  ['Habit',   'Cold shower',           'Finished the shower cold.'],
  ['Habit',   'Two-drink maximum',     'Stayed within your alcohol limit.'],
  ['Habit',   'No nicotine',           'No nicotine today.'],

  // Habits — mind & discipline
  ['Habit',   'Read 20 minutes',       'Read for at least 20 minutes today.'],
  ['Habit',   'Deep work block',       'Completed at least one focused, distraction-free deep-work session.'],
  ['Habit',   'Inbox to zero',         'Cleared / triaged your inbox today.'],
  ['Habit',   'No social media before noon', 'Stayed off social platforms until midday.'],
  ['Habit',   'Phone out of bedroom',  'Slept without the phone within arm\'s reach.'],
  ['Habit',   'Journaled',             'Wrote in your journal today.'],
  ['Habit',   'Planned tomorrow',      'Wrote tomorrow\'s priorities before bed.'],

  // Habits — finance
  ['Habit',   'Logged spending',       'Recorded today\'s expenses.'],
  ['Habit',   'No impulse purchases',  'Avoided unplanned discretionary purchases.'],

  // Habits — relationships & service
  ['Habit',   'Called a loved one',     'Reached out to a family member or close friend.'],
  ['Habit',   'Acted with kindness',    'Did one deliberate act of kindness or service today.'],
  ['Habit',   'Listened well',          'Held back from interrupting in at least one conversation.'],
  ['Habit',   'Service / Charity',      'Performed an act of service or charity today.'],

  // Habits — spiritual rule of life (any tradition). The spiritual
  // report reads the entire log and weighs every habit, so no special
  // prefix is needed.
  ['Habit',   'Morning prayer rule',    'Completed your morning prayer rule.'],
  ['Habit',   'Evening prayer rule',    'Completed your evening prayer rule.'],
  ['Habit',   'Jesus Prayer',           'Said the Jesus / Theotokos prayer rope today.'],
  ['Habit',   'Prostrations',           'Completed your prostrations.'],
  ['Habit',   'Kept the fast',          'Kept the fasting rule for today.'],
  ['Habit',   'Scripture reading',      'Read scripture today.'],
  ['Habit',   'Read a saint\'s life',   'Read a saint\'s life or a spiritual classic today.'],
  ['Habit',   'Attended liturgy',       'Attended Liturgy or a service today.'],
  ['Habit',   'Almsgiving',             'Gave alms / acted in charity today.'],
  ['Habit',   'Kept silence',           'Held silence rather than gossip / idle words.'],
  ['Habit',   'Guarded the mind',       'Caught a passion early and resisted it before it took root.'],

  // Habits — guarding the passions (positive phrasing — Success means
  // the temptation was resisted, not given in to).
  ['Habit',   'Avoided digital bypass', 'Did not use phone / internet to numb out or escape.'],
  ['Habit',   'Avoided judgement',      'Caught judgemental thoughts early and let them go without speaking them.'],
  ['Habit',   'Avoided snapping',       'Stayed measured rather than snapping at someone in frustration.'],
  ['Habit',   'Ignored lustful thoughts','Refused to dwell on lustful thoughts when they arose.'],
  ['Habit',   'Avoided lust',           'Did not act on lustful impulses today.'],
  ['Habit',   'Avoided lustful gazing', 'Guarded the eyes; did not linger on lustful images or people.'],
  ['Habit',   'Avoided media binge',    'Did not lose the evening to mindless streaming / scrolling.'],
  ['Habit',   'Avoided criticism',      'Did not criticise others behind their back today.'],
  ['Habit',   'Avoided gluttony',       'Ate to nourishment, not to excess.'],
  ['Habit',   'Avoided crude jokes',    'Refrained from crude or vulgar humour today.']
];

function getLibraryHeaders_() {
  return ['Select', 'Type', 'Name', 'Description'];
}

/**
 * Creates the Habit_Library tab if missing and seeds it with the
 * curated list. On re-runs, missing rows from DEFAULT_LIBRARY are
 * appended without disturbing user-added rows or current selections.
 * Always (re)applies checkbox + dropdown validation across column A
 * and column B respectively.
 */
function ensureLibraryTab_(ss) {
  let sh = ss.getSheetByName(TAB_LIBRARY);
  const headers = getLibraryHeaders_();
  const isNew = !sh;
  if (isNew) sh = ss.insertSheet(TAB_LIBRARY);

  if (isNew || sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#eee');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 70);
    sh.setColumnWidth(2, 90);
    sh.setColumnWidth(3, 240);
    sh.setColumnWidth(4, 540);
  }

  const existingNames = new Set();
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().forEach(r => {
      const n = String(r[0] || '').trim();
      if (n) existingNames.add(n);
    });
  }

  const toAppend = DEFAULT_LIBRARY
    .filter(r => !existingNames.has(r[1]))
    .map(r => [false, r[0], r[1], r[2]]);
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  // (Re)apply formatting so it survives anything the user did.
  const lastRow = Math.max(sh.getLastRow(), 2);
  const dataRows = lastRow - 1;
  if (dataRows > 0) {
    sh.getRange(2, 1, dataRows, 1).insertCheckboxes();
    const typeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Context', 'Habit'], true)
      .setAllowInvalid(false)
      .build();
    sh.getRange(2, 2, dataRows, 1).setDataValidation(typeRule);
  }
  return sh;
}


/**
 * Internal: write a single key/value into User_Profile, updating the
 * row if it exists or appending a new one if not.
 */
function profileSet_(key, value) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_USER_PROF);
  if (!sh) throw new Error(`Missing tab '${TAB_USER_PROF}'.`);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value, '']);
}

/**
 * Stores the Gemini API key in Script Properties.
 *
 * Two ways to call this:
 *   - From the spreadsheet menu (Life OS → Set Gemini API key…), which
 *     opens a prompt for the key.
 *   - Programmatically: setApiKey('AIza...').
 *
 * The Apps Script editor's Run button cannot pass parameters, so when
 * called with no argument the function falls back to the prompt dialog.
 */
function setApiKey(key) {
  if (!key) {
    let ui;
    try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
    if (!ui) {
      throw new Error(
        "setApiKey needs the key. Either run it from the spreadsheet menu " +
        "(Life OS → Set Gemini API key…) or call setApiKey('AIza...') from code."
      );
    }
    const resp = ui.prompt(
      'Set Gemini API key',
      'Paste your Gemini API key. It will be stored in Script Properties (private to the script owner) and never written to the spreadsheet or to source code.',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    key = resp.getResponseText();
  }
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('No API key provided.');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_API_KEY, key.trim());
  try {
    SpreadsheetApp.getUi().alert('API key saved to Script Properties.');
  } catch (e) {
    Logger.log('API key stored in Script Properties.');
  }
}

function ensureTab_(ss, name, seedRows) {
  let sh = ss.getSheetByName(name);
  const isNew = !sh;
  if (!sh) sh = ss.insertSheet(name);

  if (!seedRows || !seedRows.length) return sh;

  // Fresh tab, or existing tab with no header row at all.
  if (isNew || sh.getLastRow() === 0) {
    sh.getRange(1, 1, seedRows.length, seedRows[0].length).setValues(seedRows);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, seedRows[0].length);
    return sh;
  }

  // Existing key/value tabs: top up missing keys without clobbering edits.
  if (name === TAB_USER_PROF || name === TAB_SYS_DOCS) {
    const existing = sh.getDataRange().getValues();
    const haveKey = new Set(existing.slice(1).map(r => String(r[0] || '').trim()));
    const toAppend = seedRows.slice(1).filter(r => !haveKey.has(String(r[0]).trim()));
    if (toAppend.length) {
      sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, seedRows[0].length).setValues(toAppend);
    }
  }
  // For Responses we never overwrite existing headers — the user may
  // have customised them. They only get seeded when the tab is new or
  // empty (handled above).
  return sh;
}


/* =========================================================================
 * SECTION 4 — DEFAULT SEED DATA
 * Defaults for User_Profile and System_Docs. Used only on first run.
 * After setup, edit the spreadsheet, not this file.
 * ========================================================================= */

/**
 * Default header row for the Responses tab — kept intentionally minimal.
 *
 * The script keys off three markers from User_Profile (col_spacer,
 * col_end, col_score). Free-text context columns go to the left of the
 * spacer, binary habit columns go to its right, and the AI feedback
 * and score columns go at the end.
 *
 * Users build their own schema from the Dashboard. We ship one
 * context column (Journal), the spacer, the AI feedback column, and
 * the score column. The spiritual subsystem reads the entire daily
 * log — there is no "spiritual" column prefix.
 */
const DEFAULT_RESPONSES_HEADERS = [
  'ID', 'Date',
  'Journal',
  '>> HABITS >>',
  'AI_Feedback_Log', 'Daily_Score'
];

const DEFAULT_PROFILE = [
  ['key',                            'value',                          'description'],
  ['email',                          '',                               'Where reports are sent. Required.'],
  ['model_name',                     'gemini-2.5-pro',                 'Gemini model used for all calls.'],
  ['timezone',                       'America/New_York',               'Used when stamping biography entries.'],
  ['location',                       '',                               'Free text, used in prompts (e.g. city / region).'],
  ['faith',                          '',                               'Free text, used in prompts (your faith tradition, if any).'],
  ['career',                         '',                               'Free text, used in prompts (current role / studies / goals).'],
  ['goals',                          '',                               'Free text, used in prompts (current life goals).'],
  ['spiritual_context',              '',                               'Free text. Your spiritual goals, current situation, tradition, and rule of life. Appended to the spiritual report prompt as authoritative framing.'],
  ['col_spacer',                     '>> HABITS >>',                   'Header marking the start of habit tracker columns on Responses.'],
  ['col_end',                        'AI_Feedback_Log',                'Header where daily AI feedback is written. Marks end of habits.'],
  ['col_score',                      'Daily_Score',                    'Header where the daily score is written.'],
  ['spiritual_lookback_days',        '14',                             'How many recent rows of Responses the spiritual review reads.'],
  ['spiritual_bio_max_chars',        '6000',                           'Cap on biography text fed back as memory each run.'],
  ['enable_search_daily',            'TRUE',                           'Use Google Search grounding for the daily report.'],
  ['enable_search_weekly',           'TRUE',                           'Use Google Search grounding for the weekly report.'],
  ['enable_search_spiritual',        'TRUE',                           'Use Google Search grounding for the spiritual report.']
];

function getDefaultDocs_() {
  return [
    ['key', 'value', 'description'],

    ['persona_strategic',
`SYSTEM: Strategic Executive Coach.
TONE: Professional, Insightful, Encouraging, and Analytical.
FORMAT: HTML-ready Markdown.`,
'Persona used for daily/weekly/monthly/annual reports.'],

    ['persona_spiritual',
`SYSTEM: You are a thoughtful spiritual director writing for the user described below.
TONE: Pastoral, honest, encouraging without flattery, rooted in the user's stated faith tradition. Avoid generic self-help language and avoid moralizing.`,
'Persona used for the spiritual analysis report. Edit to suit your tradition.'],

    ['prompt_daily',
`{{persona_strategic}}

OBJECTIVE: Generate a Daily Strategic Briefing.

INPUT DATA:
1. **TODAY'S LOG:** {{data}}
2. **YESTERDAY'S DIRECTIVES (ACCOUNTABILITY):**
"{{memory}}"

USER PROFILE:
{{user_profile}}

---

### INSTRUCTIONS FOR OUTPUT:

**PART 1: 📋 Execution & Integrity Report**
- **Habit Audit:** List specific failures/misses from the log as brief bullet points.
- **The Primary Gap:** Select the single most impactful miss. Analyze it using this format:
  * **Status:** (MISSED/PARTIAL)
  * **The Context:** Briefly explain what happened vs. what was planned.
  * **The Friction:** Analyze *why* it happened. Be analytical.
  * **The Adjustment:** A sustainable fix for next time.

**PART 2: 🔄 Feedback Loop**
- Compare yesterday's PART 5 directives against today's log.
- If followed: highlight the win. If not: identify the barrier without scolding.

**PART 3: 🛡️ Daily Analysis**
- Exactly 3 numbered observations focused on cause and effect.

**PART 4: 🌍 Opportunity Scout (External Intelligence)**
- Search for 3 high-value local events relevant to the user profile above.
- Use this exact structure for every event:

  **Event Name**
  * **Date:** [Date & Time]
  * **Location:** [Specific Venue/Address]
  * **Why it matters:** [Specific relevance]
  <br>

**PART 5: ⚔️ Tactical Directives (Immediate Action)**
- Exactly 3 directives for tomorrow, labeled **1. Logistics**, **2. Well-being**, **3. Mindset**.

**SCORING INSTRUCTION:**
- Score = (✅ Success items) / (Total items) * 100, rounded.
- End response with "SCORE: [0-100]" on a new line.`,
'Daily report template. Use {{data}}, {{memory}}, {{user_profile}}, {{persona_strategic}}.'],

    ['prompt_weekly',
`{{persona_strategic}}
OBJECTIVE: Weekly Strategy Review.
USER PROFILE:
{{user_profile}}
PREVIOUS CONTEXT: "{{memory}}"
DATA: {{data}}
TASKS:
1. ### 📊 Trend Analysis
2. ### 🧠 Psychological Audit
3. ### 🧭 Course Corrections`,
'Weekly report template.'],

    ['prompt_monthly',
`{{persona_strategic}}
OBJECTIVE: Monthly Board Meeting.
USER PROFILE:
{{user_profile}}
PREVIOUS CONTEXT: "{{memory}}"
FULL CONTEXT: {{data}}
TASKS:
1. ### 📊 Performance Grade
2. ### 🔗 Strategic Correlations
3. ### 🚀 Pivot Ideas`,
'Monthly report template.'],

    ['prompt_annual',
`{{persona_strategic}}
OBJECTIVE: Annual Biography.
USER PROFILE:
{{user_profile}}
DATA: {{data}}
TASKS:
1. ### 📖 Chapter Title
2. ### 🏹 The Narrative Arc
3. ### 🔮 Future Scenarios`,
'Annual report template.'],

    ['spiritual_column_semantics',
`HOW TO READ THE LOG:
- Free-text columns (e.g. Journal, gratitude, reflections) reveal internal dispositions — peace, distraction, anger, lust, gratitude, sorrow, acedia, consolation. Use them to read the heart underneath the external practices.
- Habit columns are binary practice trackers (Success / Fail / Exempt). They are the external scaffold of the spiritual life — prayer, fasting, almsgiving, attendance, sleep, study, restraint of the passions, etc.
- Habits are phrased POSITIVELY. "Success" always means the practice was kept or the temptation resisted; "Fail" always means it wasn't.
- Do not require columns to be tagged as "spiritual" to engage with them spiritually. The whole life is one life — physical discipline, work, relationships, and rest all bear on the soul. Weigh everything in the log together rather than analysing the practices, the dispositions, and the lived context as three disconnected lists.`,
'Tells the model how to interpret the columns it sees. Edit to match your conventions.'],

    ['prompt_spiritual',
`{{persona_spiritual}}

USER PROFILE:
{{user_profile}}

USER'S OWN SPIRITUAL CONTEXT (the user wrote this themselves; treat as authoritative framing for goals, situation, tradition, and current focus):
"""
{{spiritual_context}}
"""

OBJECTIVE: Analyze the user's spiritual life over the last {{days_back}} days using the FULL DAILY LOG below, in conversation with the recent chapters of the user's spiritual biography. Then produce TWO outputs separated by the EXACT delimiters specified.

You receive the entire daily log — all habits and all free-text context columns — not a filtered subset. Weigh every column for what it reveals about the soul.

PRIOR SPIRITUAL BIOGRAPHY (recent chapters; treat as memory and as the arc to remain in conversation with):
"""
{{prior_bio}}
"""

{{spiritual_column_semantics}}

DAILY LOG (last {{days_back}} days):
"""
{{data}}
"""

OUTPUT FORMAT — emit the two delimiters exactly, with no extra prose before, between (other than the report content), or after the END marker:

===SPIRITUAL_REPORT===
### 🕯️ Spiritual Life Review
A short orienting paragraph (3–5 sentences) naming the season this window represents.

### 📿 Findings
- 4–6 specific, evidence-based observations drawn directly from the log. Reference the actual habit/reflection columns by name. Note streaks, gaps, and patterns. Distinguish between *external* practice and *internal* dispositions where the log allows.

### 🪞 Patterns & Tensions
- 2–3 deeper patterns that connect this window to the prior biography. What is recurring? What is shifting? Where is there consolation vs. desolation?

### 🛡️ Recommendations
- Exactly 3 concrete, sustainable recommendations grounded in the user's faith tradition. Each 1–2 sentences, actionable in the next 1–2 weeks.

### ⛪ Upcoming Anchors
- Search for 2–3 upcoming feast days, fasts, or local events relevant to the user's faith and location within the next ~14 days. Use this exact structure for each:

  **Event / Feast Name**
  * **Date:** [Date]
  * **Location / Tradition:** [Parish or liturgical context]
  * **Why it matters now:** [Tie it to the user's current spiritual season]
  <br>

===BIOGRAPHY_ENTRY===
Write 2–3 paragraphs (roughly 150–300 words total) that read as a chapter in an ongoing spiritual biography of this person. Use third person ("He…" or "She…" — match the user profile). Past tense or present perfect. Narrative, theologically literate, unhurried voice — closer to a spiritual memoir than a status report. Weave together the findings, the prior biography, and the recommendations into a coherent story of the soul's movement during this period. Do NOT use bullet points, headers, or markdown in this section. End the section with one final sentence that names what this chapter is *about* — a thematic title-line set off as its own sentence.
===END===`,
'Spiritual report template. Edit recommendation framing/persona to match your tradition.']
  ];
}


/* =========================================================================
 * SECTION 5 — REPORT PROCESSORS
 * Daily / Weekly / Monthly / Annual. Reads the Responses tab, formats a
 * context string, calls Gemini using a System_Docs template, writes the
 * result back to Responses (daily) or User_Memory (weekly+).
 * ========================================================================= */

function processReport(type, daysBack) {
  const profile = getProfile();
  const email = profile.email;

  try {
    const ss = getSpreadsheet_();
    const dataSheet = ss.getSheetByName(TAB_RESPONSES);
    const memorySheet = ss.getSheetByName(TAB_USER_MEM);

    if (!dataSheet || !memorySheet) {
      throw new Error(`Missing '${TAB_RESPONSES}' or '${TAB_USER_MEM}' tab. Run setupSpreadsheet().`);
    }

    const COL_SPACER = profile.col_spacer || '>> HABITS >>';
    const COL_END    = profile.col_end    || 'AI_Feedback_Log';
    const COL_SCORE  = profile.col_score  || 'Daily_Score';

    const rows = dataSheet.getDataRange().getValues();
    if (rows.length < 2) return;
    const headers = rows[0];

    const spacerIndex = headers.indexOf(COL_SPACER);
    const endIndex    = headers.indexOf(COL_END);
    const scoreIndex  = headers.indexOf(COL_SCORE);
    const dateIndex   = headers.indexOf('Date');

    if (spacerIndex === -1 || endIndex === -1) {
      throw new Error(`Missing marker columns '${COL_SPACER}' or '${COL_END}' on '${TAB_RESPONSES}'.`);
    }

    const startRow = Math.max(1, rows.length - daysBack);
    const relevantRows = rows.slice(startRow);
    if (relevantRows.length === 0) return;

    let contextString = `--- RAW DATA LOG (${type} VIEW) ---\n`;
    relevantRows.forEach((row, i) => {
      const entryDate = (dateIndex > -1 && row[dateIndex])
        ? new Date(row[dateIndex]).toLocaleDateString()
        : `Day -${daysBack - i}`;
      contextString += `\n[ENTRY ${i + 1} | ${entryDate}]:\n`;

      for (let c = 0; c < spacerIndex; c++) {
        const header = headers[c];
        const val = row[c];
        if (header !== 'ID' && header !== 'Date' && header !== '_RowNumber' && header !== COL_SCORE && val !== '') {
          contextString += `📝 ${String(header).toUpperCase()}: "${val}"\n`;
        }
      }

      for (let c = spacerIndex + 1; c < endIndex; c++) {
        const val = row[c];
        const header = headers[c];
        const status = val ? val.toString() : 'Fail';
        if (/^success$/i.test(status) || status === 'TRUE' || val === true) {
          contextString += `✅ ${header}: Success\n`;
        } else if (/^fail/i.test(status) || status === 'FALSE' || val === false) {
          contextString += `❌ ${header}: Fail\n`;
        } else if (/^exempt$/i.test(status)) {
          contextString += `⏸️ ${header}: Exempt\n`;
        } else if (val !== '') {
          contextString += `🔹 ${header}: ${val}\n`;
        }
      }
      contextString += '--------------------------------\n';
    });

    let lastOrder = 'No previous advice.';
    if (type === 'DAILY') {
      if (rows.length > 2) lastOrder = rows[rows.length - 2][endIndex];
    } else {
      const memRows = memorySheet.getDataRange().getValues();
      for (let i = memRows.length - 1; i >= 1; i--) {
        if (memRows[i][2] === type) { lastOrder = memRows[i][3]; break; }
      }
    }

    const templateKey = `prompt_${type.toLowerCase()}`;
    const prompt = buildPrompt(templateKey, { data: contextString, memory: lastOrder });

    const useSearch = (type === 'DAILY'  && profileGetBool('enable_search_daily',  true)) ||
                      (type === 'WEEKLY' && profileGetBool('enable_search_weekly', true));

    const aiResponse = callGemini(prompt, useSearch);
    if (!aiResponse) throw new Error('Gemini returned empty response.');

    let finalOutput = aiResponse;
    let numericScore = null;
    const scoreMatch = aiResponse.match(/SCORE:\s*(\d+)/i);
    if (scoreMatch) {
      numericScore = parseInt(scoreMatch[1]);
      finalOutput = finalOutput.replace(scoreMatch[0], '').trim();
    }

    const htmlBody = formatToHtml(finalOutput);
    const cleanText = stripMarkdown(finalOutput);

    if (type === 'DAILY') {
      dataSheet.getRange(rows.length, endIndex + 1).setValue(cleanText);
      if (scoreIndex > -1 && numericScore !== null) {
        dataSheet.getRange(rows.length, scoreIndex + 1).setValue(numericScore);
      }
      if (email) {
        MailApp.sendEmail({
          to: email,
          subject: `🛡️ Daily Briefing (Score: ${numericScore || 'N/A'})`,
          htmlBody: wrapEmail(htmlBody, 'Daily Tactical Check', '#27ae60')
        });
      }
    } else {
      memorySheet.appendRow([Utilities.getUuid(), new Date(), type, cleanText]);
      if (email) {
        MailApp.sendEmail({
          to: email,
          subject: `📈 ${type} Report`,
          htmlBody: wrapEmail(htmlBody, `${type} Strategic Review`, '#2980b9')
        });
      }
    }

  } catch (e) {
    Logger.log('SYSTEM FAILURE: ' + e);
    if (email) {
      MailApp.sendEmail({
        to: email,
        subject: '⚠️ Life OS Failure',
        htmlBody: `<h3>Script Error</h3><p>${e}</p>`
      });
    }
  }
}


/* =========================================================================
 * SECTION 6 — SPIRITUAL ANALYSIS
 * Reads the FULL Responses log (every habit + every free-text column)
 * over the lookback window. Spiritual framing comes from two sources:
 *   1. The user's "spiritual_context" entry in User_Profile, which is
 *      injected verbatim into the prompt as authoritative framing.
 *   2. The recent chapters of the Spiritual_Biography, which act as
 *      memory and arc.
 * ========================================================================= */

function processSpiritualReport(daysBack) {
  const profile = getProfile();
  const email = profile.email;

  try {
    const ss = getSpreadsheet_();
    const dataSheet = ss.getSheetByName(TAB_RESPONSES);
    const bioSheet  = ss.getSheetByName(TAB_SPIRIT_BIO);
    const memSheet  = ss.getSheetByName(TAB_USER_MEM);
    if (!dataSheet) throw new Error(`Missing '${TAB_RESPONSES}' tab.`);
    if (!bioSheet)  throw new Error(`Missing '${TAB_SPIRIT_BIO}' tab. Run setupSpreadsheet().`);

    const rows = dataSheet.getDataRange().getValues();
    if (rows.length < 2) {
      Logger.log('Spiritual report: no data rows.');
      return;
    }
    const headers = rows[0];

    const COL_SPACER = profile.col_spacer || '>> HABITS >>';
    const COL_END    = profile.col_end    || 'AI_Feedback_Log';
    const COL_SCORE  = profile.col_score  || 'Daily_Score';
    const dateIndex   = headers.indexOf('Date');
    const spacerIndex = headers.indexOf(COL_SPACER);
    const endIndex    = headers.indexOf(COL_END);

    const startRow = Math.max(1, rows.length - daysBack);
    const relevantRows = rows.slice(startRow);
    if (relevantRows.length === 0) return;

    // Format the daily log the same way the daily/weekly/monthly
    // processor does: free-text context columns first, then the
    // success/fail/exempt habit columns.
    let contextString = `--- DAILY LOG (last ${relevantRows.length} entries, ${daysBack}-day window) ---\n`;
    relevantRows.forEach((row, i) => {
      const entryDate = (dateIndex > -1 && row[dateIndex])
        ? new Date(row[dateIndex]).toLocaleDateString()
        : `Entry ${i + 1}`;
      contextString += `\n[${entryDate}]\n`;

      const ctxStop = spacerIndex > -1 ? spacerIndex : headers.length;
      for (let c = 0; c < ctxStop; c++) {
        const header = headers[c];
        const val = row[c];
        if (val === '' || val === null || val === undefined) continue;
        if (header === 'ID' || header === 'Date' || header === '_RowNumber' || header === COL_SCORE) continue;
        contextString += `  📝 ${String(header).toUpperCase()}: "${val}"\n`;
      }

      if (spacerIndex > -1 && endIndex > -1) {
        for (let c = spacerIndex + 1; c < endIndex; c++) {
          const val = row[c];
          const header = headers[c];
          if (val === '' || val === null || val === undefined) continue;
          const status = String(val);
          if (/^success$/i.test(status) || status === 'TRUE' || val === true) {
            contextString += `  ✅ ${header}: Success\n`;
          } else if (/^fail/i.test(status) || status === 'FALSE' || val === false) {
            contextString += `  ❌ ${header}: Fail\n`;
          } else if (/^exempt$/i.test(status)) {
            contextString += `  ⏸️ ${header}: Exempt\n`;
          } else {
            contextString += `  🔹 ${header}: ${val}\n`;
          }
        }
      }
    });

    const priorBio = readPriorBiography_(bioSheet);
    const spiritualContext = profile.spiritual_context
      ? String(profile.spiritual_context)
      : '(The user has not written a spiritual context. Proceed using the User Profile and the daily log alone.)';

    const prompt = buildPrompt('prompt_spiritual', {
      data: contextString,
      prior_bio: priorBio,
      spiritual_context: spiritualContext,
      days_back: daysBack
    });
    const useSearch = profileGetBool('enable_search_spiritual', true);

    const aiResponse = callGemini(prompt, useSearch);
    if (!aiResponse) throw new Error('Gemini returned empty response.');

    const split = splitSpiritualResponse_(aiResponse);
    appendBiographyRow_(bioSheet, split.bioEntry);

    const sheetUrl = ss.getUrl();
    const htmlBody = formatToHtml(split.report) +
      `<br><br><div style="font-size:12px;color:#888;">📖 ` +
      `<a href="${sheetUrl}#gid=${bioSheet.getSheetId()}" style="color:#8e44ad;">Open Spiritual Biography tab</a> — a new chapter was just appended.</div>`;

    if (email) {
      MailApp.sendEmail({
        to: email,
        subject: `🕯️ Spiritual Life Review (${relevantRows.length}-day window)`,
        htmlBody: wrapEmail(htmlBody, 'Spiritual Life Review', '#8e44ad')
      });
    }
    if (memSheet) {
      memSheet.appendRow([Utilities.getUuid(), new Date(), 'SPIRITUAL', stripMarkdown(split.report)]);
    }

  } catch (e) {
    Logger.log('SPIRITUAL ANALYSIS FAILURE: ' + e);
    if (email) {
      MailApp.sendEmail({
        to: email,
        subject: '⚠️ Spiritual Analysis Failure',
        htmlBody: `<h3>Script Error</h3><p>${e}</p>`
      });
    }
  }
}

function readPriorBiography_(bioSheet) {
  const cap = profileGetInt('spiritual_bio_max_chars', 6000);
  const rows = bioSheet.getDataRange().getValues();
  if (rows.length < 2) return '(No prior spiritual biography. This is the first chapter.)';

  const tz = profileGet('timezone', 'America/New_York');
  const chunks = [];
  let total = 0;

  for (let i = rows.length - 1; i >= 1; i--) {
    const date = rows[i][0];
    const title = rows[i][2];
    const narrative = rows[i][3];
    if (!narrative) continue;
    const dateLabel = date instanceof Date
      ? Utilities.formatDate(date, tz, 'MMMM d, yyyy')
      : String(date || '');
    const block = `--- ${dateLabel}${title ? ' — ' + title : ''} ---\n${narrative}`;
    total += block.length;
    chunks.unshift(block);
    if (total >= cap) {
      chunks.unshift('...[earlier chapters truncated for brevity]...');
      break;
    }
  }
  return chunks.join('\n\n') || '(No prior spiritual biography. This is the first chapter.)';
}

function appendBiographyRow_(bioSheet, narrativeRaw) {
  const narrative = stripMarkdown(narrativeRaw || '').trim();

  // Heuristic: the prompt asks the model to end with a thematic title-line
  // as its own sentence. Take the last non-empty line as the title.
  let title = '';
  let body = narrative;
  const lines = narrative.split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (lines.length > 1) {
    title = lines[lines.length - 1];
    if (title.length > 120) {
      title = '';
    } else {
      body = lines.slice(0, -1).join('\n\n');
    }
  }

  bioSheet.appendRow([new Date(), 'SPIRITUAL', title, body, '']);
}

function splitSpiritualResponse_(text) {
  const reportIdx = text.indexOf(SPIRIT_DELIM_REPORT);
  const bioIdx    = text.indexOf(SPIRIT_DELIM_BIO);
  const endIdx    = text.indexOf(SPIRIT_DELIM_END);

  let report, bioEntry;
  if (reportIdx !== -1 && bioIdx !== -1 && bioIdx > reportIdx) {
    report = text.substring(reportIdx + SPIRIT_DELIM_REPORT.length, bioIdx).trim();
    bioEntry = (endIdx !== -1 && endIdx > bioIdx)
      ? text.substring(bioIdx + SPIRIT_DELIM_BIO.length, endIdx).trim()
      : text.substring(bioIdx + SPIRIT_DELIM_BIO.length).trim();
  } else {
    report = text.trim();
    bioEntry = '(The model did not produce a separate biography entry. Full report archived below.)\n\n' + text.trim();
  }
  return { report: report, bioEntry: bioEntry };
}


/* =========================================================================
 * SECTION 7 — CONFIG READERS
 * Helpers that read User_Profile and System_Docs so the rest of the
 * script never touches sheets directly for config.
 * ========================================================================= */

function getSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Run from a sheet-bound script.');
  return ss;
}

function getProfile() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_USER_PROF);
  if (!sh) throw new Error(`Missing tab '${TAB_USER_PROF}'. Run setupSpreadsheet() first.`);
  const rows = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0] || '').trim();
    if (!k) continue;
    out[k] = rows[i][1];
  }
  return out;
}

function profileGet(key, fallback) {
  const p = getProfile();
  const v = p[key];
  return (v === undefined || v === '' || v === null) ? fallback : v;
}
function profileGetBool(key, fallback) {
  const v = profileGet(key, fallback);
  if (typeof v === 'boolean') return v;
  return /^(true|yes|1)$/i.test(String(v));
}
function profileGetInt(key, fallback) {
  const v = profileGet(key, fallback);
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}
function profileGetList(key, fallback) {
  const v = profileGet(key, fallback || '');
  if (!v) return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

function getDocs() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(TAB_SYS_DOCS);
  if (!sh) throw new Error(`Missing tab '${TAB_SYS_DOCS}'. Run setupSpreadsheet() first.`);
  const rows = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0] || '').trim();
    if (!k) continue;
    out[k] = rows[i][1] != null ? String(rows[i][1]) : '';
  }
  return out;
}

function docGet(key, fallback) {
  const d = getDocs();
  const v = d[key];
  return (v === undefined || v === '' || v === null) ? fallback : v;
}

function getApiKey_() {
  const k = PropertiesService.getScriptProperties().getProperty(PROP_API_KEY);
  if (!k) {
    throw new Error(
      "GEMINI_API_KEY is not set. In the Apps Script editor, run setApiKey('your-key-here') once, " +
      "or paste it via Project Settings -> Script Properties."
    );
  }
  return k;
}

function renderUserProfile() {
  const p = getProfile();
  const fields = [
    ['LOCATION', p.location],
    ['FAITH',    p.faith],
    ['CAREER',   p.career],
    ['GOALS',    p.goals]
  ];
  return fields
    .filter(f => f[1])
    .map(f => `  - ${f[0]}: ${f[1]}`)
    .join('\n');
}


/* =========================================================================
 * SECTION 8 — PROMPT TEMPLATING
 * Substitutes {{placeholders}} into templates pulled from System_Docs.
 *
 * Supported placeholders:
 *   {{user_profile}} {{data}} {{memory}} {{prior_bio}} {{days_back}}
 *   {{persona_strategic}} {{persona_spiritual}} {{spiritual_column_semantics}}
 * Plus any User_Profile key. Unknown {{keys}} are left as-is so typos
 * are easy to spot in the output.
 * ========================================================================= */

function buildPrompt(templateKey, vars) {
  const docs = getDocs();
  const profile = getProfile();
  const tpl = docs[templateKey];
  if (!tpl) throw new Error(`System_Docs is missing key '${templateKey}'. Run setupSpreadsheet() to seed defaults.`);

  const baseVars = Object.assign({
    user_profile: renderUserProfile()
  }, vars || {});

  return expandTemplate_(tpl, baseVars, docs, profile, 0);
}

function expandTemplate_(text, vars, docs, profile, depth) {
  if (depth > 6) return text; // guard against accidental cycles
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    if (vars[key] !== undefined && vars[key] !== null) return String(vars[key]);
    if (docs[key] !== undefined) return expandTemplate_(docs[key], vars, docs, profile, depth + 1);
    if (profile[key] !== undefined) return String(profile[key]);
    return m;
  });
}


/* =========================================================================
 * SECTION 9 — GEMINI CLIENT
 * Single point of contact with the Gemini API. Reads the model name from
 * User_Profile and the API key from Script Properties.
 * ========================================================================= */

function callGemini(prompt, useSearch) {
  const model = profileGet('model_name', 'gemini-2.5-pro');
  const key = getApiKey_();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  if (useSearch) {
    payload.tools = [{ google_search: {} }];
  }

  const opts = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, opts);
  const text = response.getContentText();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Non-JSON response from Gemini (HTTP ${response.getResponseCode()}): ${text.slice(0, 500)}`);
  }

  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
    return json.candidates[0].content.parts.map(p => p.text || '').join('');
  }
  return 'Error: No content returned.';
}


/* =========================================================================
 * SECTION 10 — FORMATTING
 * Markdown -> HTML for emails, and plain-text stripping for sheet cells.
 * ========================================================================= */

function formatToHtml(md) {
  let html = String(md || '');
  html = html.replace(/^# (.*$)/gim, '<h1 style="color:#2c3e50; font-size:22px; margin-top:20px; border-bottom: 2px solid #27ae60;">$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="color:#2c3e50; font-size:18px; margin-top:15px; border-bottom: 1px solid #ddd;">$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3 style="color:#2c3e50; font-size:16px; margin-top:12px; font-weight:bold;">$1</h3>');

  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/^---/gim, '<hr style="border:0; border-top:1px solid #eee; margin:20px 0;">');

  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul style="padding-left:20px; color:#444;">$1</ul>');

  html = html.replace(/\n/g, '<br>');
  return html;
}

function wrapEmail(content, title, color) {
  return `<div style="font-family:sans-serif;padding:20px;background:#f4f4f4;"><div style="max-width:600px;margin:0 auto;background:white;padding:30px;border-left:6px solid ${color};"><h2 style="margin-top:0;color:#333;">${title}</h2>${content}</div></div>`;
}

function stripMarkdown(md) {
  let text = String(md || '');
  text = text.replace(/\[\d+\]/g, '');
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/^---/gm, '────────────────');
  text = text.replace(/<br>/g, '\n');
  return text;
}
