/**
 * Gemini.gs
 * -----------------------------------------------------------------------
 * Single point of contact with the Gemini API.
 * Reads the model name from User_Profile and the API key from
 * Script Properties — nothing sensitive lives in code.
 * -----------------------------------------------------------------------
 */

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
