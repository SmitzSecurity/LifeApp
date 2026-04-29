/**
 * =========================================================================
 * LIFE OPERATING SYSTEM
 * =========================================================================
 * A single-file Apps Script. Drop this into the script editor of a fresh
 * Google Sheet, replace the manifest with the provided appsscript.json,
 * then:
 *
 *   1. Run setupSpreadsheet()           // creates and seeds every tab
 *   2. Run setApiKey('YOUR_GEMINI_KEY') // stored in Script Properties
 *   3. Fill in the User_Profile tab     // email is required
 *   4. Configure the Responses tab      // see README
 *   5. Add time-based triggers          // runDailyAudit, runSpiritualReport, ...
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

const TAB_RESPONSES   = 'Responses';
const TAB_USER_PROF   = 'User_Profile';
const TAB_USER_MEM    = 'User_Memory';
const TAB_SYS_DOCS    = 'System_Docs';
const TAB_SPIRIT_BIO  = 'Spiritual_Biography';

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

  ensureTab_(ss, TAB_RESPONSES,  null);
  ensureTab_(ss, TAB_USER_PROF,  DEFAULT_PROFILE);
  ensureTab_(ss, TAB_USER_MEM,   [['id', 'timestamp', 'type', 'content']]);
  ensureTab_(ss, TAB_SYS_DOCS,   getDefaultDocs_());
  ensureTab_(ss, TAB_SPIRIT_BIO, [['date', 'type', 'title', 'narrative', 'tags']]);

  if (SpreadsheetApp.getUi) {
    try {
      SpreadsheetApp.getUi().alert(
        'Life OS is set up.\n\n' +
        '1. Fill in User_Profile (email, location, faith, etc.).\n' +
        '2. Run setApiKey("your-gemini-key") once.\n' +
        '3. Configure your Responses sheet (see README).\n' +
        '4. Add time-based triggers for runDailyAudit, runWeeklyReport, etc.'
      );
    } catch (e) { /* running outside the UI is fine */ }
  }
}

/**
 * Stores the Gemini API key in Script Properties.
 * USAGE: in the editor, run setApiKey('AIza...') once.
 */
function setApiKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Pass the API key as a string, e.g. setApiKey("AIza...").');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_API_KEY, key.trim());
  Logger.log('API key stored in Script Properties.');
}

function ensureTab_(ss, name, seedRows) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (seedRows && seedRows.length) {
      sh.getRange(1, 1, seedRows.length, seedRows[0].length).setValues(seedRows);
      sh.setFrozenRows(1);
      sh.autoResizeColumns(1, seedRows[0].length);
    }
    return sh;
  }
  if (seedRows && seedRows.length && (name === TAB_USER_PROF || name === TAB_SYS_DOCS)) {
    const existing = sh.getDataRange().getValues();
    const haveKey = new Set(existing.slice(1).map(r => String(r[0] || '').trim()));
    const toAppend = seedRows.slice(1).filter(r => !haveKey.has(String(r[0]).trim()));
    if (toAppend.length) {
      sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, seedRows[0].length).setValues(toAppend);
    }
  }
  return sh;
}


/* =========================================================================
 * SECTION 4 — DEFAULT SEED DATA
 * Defaults for User_Profile and System_Docs. Used only on first run.
 * After setup, edit the spreadsheet, not this file.
 * ========================================================================= */

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
`COLUMN SEMANTICS — read these carefully before interpreting the log:
- "Spirit_Life" is a CONTEXT-RICH free-text column with notes on saints' lives, gospel/epistle readings, parish events, and notable spiritual moments. Mine it for substance.
- "Journal" is a free-text column reflecting INTERNAL DISPOSITIONS — peace, distraction, anger, lust, gratitude, sorrow, acedia, consolation. Use it to read the heart underneath the external practices.
- All other "Spirit_*" columns are binary practice trackers (Success / Fail / Exempt). Treat them as the external scaffold.
- Several columns are framed as "Avoided ..." or "Ignored ..." — for these, "Success" means the user *did* avoid/ignore the temptation, and "Fail" means they fell.

Weave external practices, internal dispositions, and lived context together. Do not analyze them as three disconnected lists.`,
'Tells the model how to interpret the spiritual columns. Edit if your column conventions differ.'],

    ['prompt_spiritual',
`{{persona_spiritual}}

USER PROFILE:
{{user_profile}}

OBJECTIVE: Analyze ONLY the user's spiritual life over the last {{days_back}} days using the SPIRITUAL LOG below, in conversation with the recent chapters of the user's spiritual biography. Then produce TWO outputs separated by the EXACT delimiters specified.

PRIOR SPIRITUAL BIOGRAPHY (recent chapters; treat as memory and as the arc to remain in conversation with):
"""
{{prior_bio}}
"""

{{spiritual_column_semantics}}

SPIRITUAL LOG (last {{days_back}} days):
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
 * Reads only the spiritual columns (by prefix or explicit list),
 * generates a pastoral report, and appends a dated narrative chapter to
 * the Spiritual_Biography tab. Recent chapters are read back as memory.
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
    const dateIndex = headers.indexOf('Date');

    const prefix = profile.spiritual_col_prefix || 'Spirit_';
    const explicit = profileGetList('spiritual_columns_explicit', '');
    const explicitSet = new Set(explicit);

    const spiritualIndexes = [];
    headers.forEach((h, i) => {
      const name = String(h || '');
      if (!name) return;
      const matchesPrefix = prefix && name.indexOf(prefix) === 0;
      const matchesExplicit = explicitSet.has(name);
      if (matchesPrefix || matchesExplicit) spiritualIndexes.push(i);
    });
    if (spiritualIndexes.length === 0) {
      throw new Error(
        `No spiritual columns detected. Set 'spiritual_col_prefix' or 'spiritual_columns_explicit' ` +
        `in '${TAB_USER_PROF}'.`
      );
    }

    const startRow = Math.max(1, rows.length - daysBack);
    const relevantRows = rows.slice(startRow);
    if (relevantRows.length === 0) return;

    let contextString = `--- SPIRITUAL LOG (last ${relevantRows.length} entries, ${daysBack}-day window) ---\n`;
    relevantRows.forEach((row, i) => {
      const entryDate = (dateIndex > -1 && row[dateIndex])
        ? new Date(row[dateIndex]).toLocaleDateString()
        : `Entry ${i + 1}`;
      contextString += `\n[${entryDate}]\n`;

      spiritualIndexes.forEach(c => {
        const header = headers[c];
        const val = row[c];
        if (val === '' || val === null || val === undefined) return;
        const status = String(val);
        if (/^success$/i.test(status) || status === 'TRUE' || val === true) {
          contextString += `  ✅ ${header}: Success\n`;
        } else if (/^fail/i.test(status) || status === 'FALSE' || val === false) {
          contextString += `  ❌ ${header}: Fail\n`;
        } else if (/^exempt$/i.test(status)) {
          contextString += `  ⏸️ ${header}: Exempt\n`;
        } else {
          contextString += `  📝 ${header}: "${status}"\n`;
        }
      });
    });

    const priorBio = readPriorBiography_(bioSheet);

    const prompt = buildPrompt('prompt_spiritual', {
      data: contextString,
      prior_bio: priorBio,
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
