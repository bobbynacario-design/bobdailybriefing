// Market metadata defines the outcome; last trade prices never establish settlement.
export function confirmedResolutions(markets, dateKey) {
  return (markets || []).filter(m => m && m.closed === true &&
    m.umaResolutionStatus === 'resolved' && (m.impliedYes === 0 || m.impliedYes === 1))
    .map(m => ({slug:m.slug, outcome:m.impliedYes, resolvedDate:dateKey,
      resolutionSource:m.resolutionSource || '', resolutionStatus:m.umaResolutionStatus,
      method:'confirmed-uma-terminal-price', confidence:1}));
}

export function resolutionContext(market) {
  return JSON.stringify({resolutionRules:market.resolutionRules || '',
    resolutionSource:market.resolutionSource || ''});
}
