/**
 * Prompts.gs
 * -----------------------------------------------------------------------
 * Pulls prompt templates from System_Docs and substitutes placeholders.
 *
 * Supported placeholders inside templates:
 *   {{user_profile}}             – rendered profile snippet
 *   {{data}}                     – the data context for this run
 *   {{memory}}                   – previous report (for daily/weekly/etc.)
 *   {{prior_bio}}                – recent biography chapters
 *   {{days_back}}                – lookback window (number)
 *   {{persona_strategic}}        – strategic-coach persona (System_Docs key)
 *   {{persona_spiritual}}        – spiritual-director persona (System_Docs key)
 *   {{spiritual_column_semantics}} – semantics block (System_Docs key)
 *
 * Any other {{key}} is looked up first in System_Docs, then in
 * User_Profile, then left as-is so the user can spot typos.
 * -----------------------------------------------------------------------
 */

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
