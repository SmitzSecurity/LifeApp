/**
 * Format.gs
 * -----------------------------------------------------------------------
 * Markdown -> HTML email formatting and plain-text stripping.
 * -----------------------------------------------------------------------
 */

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
