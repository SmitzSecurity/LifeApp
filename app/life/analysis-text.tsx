import {renderReportMarkdown} from '@/lib/life/report-markdown';
export default function AnalysisText({text}:{text:string}){
 return <div className="analysis-copy analysis-markdown" dangerouslySetInnerHTML={{__html:renderReportMarkdown(text)}}/>;
}
