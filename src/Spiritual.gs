/**
 * Spiritual.gs
 * -----------------------------------------------------------------------
 * Spiritual analysis subsystem.
 *
 * Reads only the columns flagged as spiritual (by prefix or explicit
 * list, both configured in User_Profile), produces a pastoral report
 * by email, and appends a dated narrative chapter to the
 * Spiritual_Biography tab. Recent biography rows are read back as
 * memory on every subsequent run so future findings stay in
 * conversation with the user's ongoing arc.
 * -----------------------------------------------------------------------
 */


const SPIRIT_DELIM_REPORT = '===SPIRITUAL_REPORT===';
const SPIRIT_DELIM_BIO    = '===BIOGRAPHY_ENTRY===';
const SPIRIT_DELIM_END    = '===END===';


function runSpiritualReport() {
  const days = profileGetInt('spiritual_lookback_days', 14);
  processSpiritualReport(days);
}


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


/**
 * Reads recent rows from the Spiritual_Biography tab and concatenates
 * their narratives, oldest first, capped to the configured character
 * budget. Columns: date, type, title, narrative, tags.
 */
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
  const tz = profileGet('timezone', 'America/New_York');
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
