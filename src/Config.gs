/**
 * Config.gs
 * -----------------------------------------------------------------------
 * Central configuration loader for the Life OS.
 *
 * Anything that a user might reasonably want to change without editing
 * code lives in the spreadsheet (User_Profile or System_Docs tabs) and
 * is read through the helpers in this file.
 *
 * Anything that is genuinely a constant of the system (tab names, the
 * Script-Properties key under which the API key is stored) lives here.
 *
 * SECRETS NEVER LIVE HERE. Use Script Properties (see Setup.gs).
 * -----------------------------------------------------------------------
 */

// Tab names. These are the only "magic strings" the system enforces;
// the bootstrapper in Setup.gs creates them on first run.
const TAB_RESPONSES   = 'Responses';
const TAB_USER_PROF   = 'User_Profile';
const TAB_USER_MEM    = 'User_Memory';
const TAB_SYS_DOCS    = 'System_Docs';
const TAB_SPIRIT_BIO  = 'Spiritual_Biography';

// Script Properties keys.
const PROP_API_KEY    = 'GEMINI_API_KEY';

// Defaults — only used to seed the spreadsheet on first run via
// setupSpreadsheet(). After that, edit the spreadsheet, not this file.
const DEFAULT_PROFILE = [
  ['key',                            'value',                          'description'],
  ['email',                          '',                               'Where reports are sent. Required.'],
  ['model_name',                     'gemini-2.5-pro',                 'Gemini model used for all calls.'],
  ['timezone',                       'America/New_York',               'Used when stamping biography entries.'],
  ['location',                       '',                               'Free text, used in prompts (e.g. city / region).'],
  ['faith',                          '',                               'Free text, used in prompts (your faith tradition, if any).'],
  ['career',                         '',                               'Free text, used in prompts (current role / studies / goals).'],
  ['goals',                          '',                               'Free text, used in prompts (current life goals).'],
  ['col_spacer',                     '>> HABITS >>',                   'Header marking the start of habit tracker columns on Responses.'],
  ['col_end',                        'AI_Feedback_Log',                'Header where daily AI feedback is written. Marks end of habits.'],
  ['col_score',                      'Daily_Score',                    'Header where the daily score is written.'],
  ['spiritual_col_prefix',           'Spirit_',                        'Headers starting with this prefix are read by the spiritual subsystem.'],
  ['spiritual_columns_explicit',     'Journal',                        'Comma-separated extra column names to feed the spiritual subsystem.'],
  ['spiritual_lookback_days',        '14',                             'How many recent rows of Responses the spiritual review reads.'],
  ['spiritual_bio_max_chars',        '6000',                           'Cap on biography text fed back as memory each run.'],
  ['enable_search_daily',            'TRUE',                           'Use Google Search grounding for the daily report.'],
  ['enable_search_weekly',           'TRUE',                           'Use Google Search grounding for the weekly report.'],
  ['enable_search_spiritual',        'TRUE',                           'Use Google Search grounding for the spiritual report.']
];


/**
 * Returns the active spreadsheet, throwing a clean error if missing.
 */
function getSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Run from a sheet-bound script.');
  return ss;
}

/**
 * Reads User_Profile as a {key: value} object.
 * The first row is treated as the header row.
 */
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

/** Convenience getters with safe defaults. */
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


/**
 * Reads System_Docs as a {key: text} map. System_Docs holds prompt
 * templates and personas; users can edit the wording of any report
 * without touching code.
 */
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


/**
 * Returns the Gemini API key from Script Properties.
 * Throws a helpful error if not set.
 */
function getApiKey_() {
  const k = PropertiesService.getScriptProperties().getProperty(PROP_API_KEY);
  if (!k) {
    throw new Error(
      "GEMINI_API_KEY is not set. In the Apps Script editor, run setApiKey('your-key-here') once " +
      "from Setup.gs, or paste it via Project Settings -> Script Properties."
    );
  }
  return k;
}


/**
 * Builds the user-profile snippet that gets injected into prompts.
 * Pulled from User_Profile so changes don't require redeploying code.
 */
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
