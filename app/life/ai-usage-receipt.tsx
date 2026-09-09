export type AIUsageReceiptData = {
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  costMicros: number | null;
  reservedMicros: number;
};

const tokens = (count: number | null) => count == null ? 'Not confirmed' : count.toLocaleString('en-US');
const dollars = (micros: number) => '$' + (micros / 1_000_000).toFixed(6);

export default function AIUsageReceipt({ usage }: { usage: AIUsageReceiptData }) {
  const costKnown = usage.costMicros != null;

  return <details className="ai-usage-receipt">
    <summary>Usage details</summary>
    <dl>
      <div><dt>Input tokens</dt><dd>{tokens(usage.inputTokens)}</dd></div>
      <div><dt>Output tokens, including thinking</dt><dd>{tokens(usage.outputTokens)}</dd></div>
      <div><dt>Thinking tokens, included above</dt><dd>{tokens(usage.thoughtTokens)}</dd></div>
      <div><dt>Provider cost (USD)</dt><dd>{costKnown ? dollars(usage.costMicros!) : 'Not confirmed'}</dd></div>
      <div><dt>Budget still reserved (USD)</dt><dd>{dollars(costKnown ? 0 : usage.reservedMicros)}</dd></div>
    </dl>
    <small>{costKnown
      ? 'Cost is calculated from the provider’s reported token usage and saved with this attempt. Thinking tokens are already included in the output total. No customer payment is collected.'
      : 'The final cost is not confirmed. The reservation continues to count toward your usage limit until this attempt is reconciled. It is not a customer charge.'}</small>
  </details>;
}
