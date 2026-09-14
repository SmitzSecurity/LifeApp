import MarkdownIt from 'markdown-it';

// Saved AI text is untrusted. Never enable raw HTML or remote images here.
const markdown=new MarkdownIt({html:false,breaks:true,linkify:false,typographer:false}).disable('image');
markdown.validateLink=(url:string)=>/^(https?:\/\/|mailto:)/i.test(url);
const styles:Record<string,string>={p:'margin:0 0 14px;line-height:1.7',h3:'font-size:20px;line-height:1.35;margin:24px 0 10px;font-weight:600',h4:'font-size:18px;line-height:1.4;margin:20px 0 8px;font-weight:600',h5:'font-size:16px;line-height:1.4;margin:18px 0 8px;font-weight:600',h6:'font-size:16px;line-height:1.4;margin:18px 0 8px;font-weight:600',ul:'padding-left:24px;margin:10px 0 18px',ol:'padding-left:24px;margin:10px 0 18px',li:'margin:5px 0',blockquote:'margin:16px 0;padding-left:16px;border-left:3px solid #9c89a3',table:'border-collapse:collapse;width:100%;margin:16px 0',th:'border:1px solid #aaa;padding:8px;text-align:left',td:'border:1px solid #aaa;padding:8px;vertical-align:top'};
export function renderReportMarkdown(text:string){
 const tokens=markdown.parse(text,{});
 for(const token of tokens){
  if(token.type==='heading_open'||token.type==='heading_close')token.tag='h'+Math.min(6,Math.max(3,Number(token.tag.slice(1))+1));
  if(token.nesting===1&&styles[token.tag])token.attrSet('style',styles[token.tag]);
  for(const child of token.children||[])if(child.type==='link_open')child.attrSet('rel','noopener noreferrer');
 }
 return markdown.renderer.render(tokens,markdown.options,{});
}
