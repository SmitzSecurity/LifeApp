/**
 * Setup.gs
 * -----------------------------------------------------------------------
 * One-time bootstrappers for new users. Idempotent: running them again
 * will create any missing tabs/rows but will not overwrite existing
 * values the user has customised.
 * -----------------------------------------------------------------------
 */


/**
 * Master setup. Run this once from the Apps Script editor after copying
 * the script into a fresh spreadsheet. It will:
 *   1. Create every required tab if missing.
 *   2. Seed User_Profile and System_Docs with default rows.
 *   3. Leave existing values untouched.
 *
 * Re-running this is safe.
 */
function setupSpreadsheet() {
  const ss = getSpreadsheet_();

  ensureTab_(ss, TAB_RESPONSES,  null); // user-managed via AppSheet
  ensureTab_(ss, TAB_USER_PROF,  DEFAULT_PROFILE);
  ensureTab_(ss, TAB_USER_MEM,   [['id', 'timestamp', 'type', 'content']]);
  ensureTab_(ss, TAB_SYS_DOCS,   getDefaultDocs_());
  ensureTab_(ss, TAB_SPIRIT_BIO, [['date', 'type', 'title', 'narrative', 'tags']]);

  SpreadsheetApp.getUi && SpreadsheetApp.getUi().alert(
    'Life OS is set up.\n\n' +
    '1. Fill in User_Profile (email, location, faith, etc.).\n' +
    '2. Run setApiKey("your-gemini-key") once.\n' +
    '3. Configure your Responses sheet (see README).\n' +
    '4. Add time-based triggers for runDailyAudit, runWeeklyReport, etc.'
  );
}


/**
 * Stores the Gemini API key in Script Properties.
 * USAGE: in the editor, run `setApiKey('AIza...')` once. The key is
 * private to the script's owner and not exposed to spreadsheet viewers.
 */
function setApiKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Pass the API key as a string, e.g. setApiKey("AIza...").');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_API_KEY, key.trim());
  Logger.log('API key stored in Script Properties.');
}


/** Internal: create a tab and optionally seed rows. */
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
  // Tab exists — top up missing keys without clobbering user edits.
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


/**
 * Default content for the System_Docs tab.
 * Each row is [key, value, description]. The "value" column is the
 * actual prompt template (or fragment) the user can edit. The Prompts.gs
 * module reads these by key and substitutes placeholders like
 * {{user_profile}}, {{data}}, {{memory}}, {{prior_bio}}, {{days_back}}.
 */
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
