/**
 * Reports.gs
 * -----------------------------------------------------------------------
 * Daily / Weekly / Monthly / Annual reports.
 *
 * Reads the Responses tab using markers from User_Profile (col_spacer,
 * col_end, col_score), formats a context string with the Bricklayer
 * regex logic, calls Gemini using a template from System_Docs, and
 * writes the result back to Responses (daily) or User_Memory (others).
 * -----------------------------------------------------------------------
 */


function runDailyAudit()    { processReport('DAILY', 1); }
function runWeeklyReport()  { processReport('WEEKLY', 7); }
function runMonthlyReview() { processReport('MONTHLY', 30); }
function runAnnualReview()  { processReport('ANNUAL', 365); }


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
