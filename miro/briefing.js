// Pure helpers for turning raw event-market snapshots into a useful daily brief.

function numberOrNull(value) {
  if (value == null || value === '') return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function enrichMarketChanges(markets, previousDoc) {
  var previous = {};
  ((previousDoc && previousDoc.markets) || []).forEach(function (market) {
    if (market && market.slug) previous[market.slug] = market;
  });

  var enriched = (markets || []).map(function (market) {
    var prior = previous[market.slug];
    var currentPrice = numberOrNull(market.impliedYes);
    var priorPrice = prior ? numberOrNull(prior.impliedYes) : null;
    var change = currentPrice != null && priorPrice != null ? currentPrice - priorPrice : null;
    var priority = numberOrNull(market.priority);
    var liquidity = Math.max(0, numberOrNull(market.liquidityNum) || 0);
    var movementPoints = change == null ? 0 : Math.min(20, Math.abs(change) * 100);
    var liquidityPoints = Math.min(4, Math.log10(liquidity + 1));

    return Object.assign({}, market, {
      previousImpliedYes: priorPrice,
      priceChange: change,
      attentionScore: (priority == null ? 3 : priority) * 10 + movementPoints + liquidityPoints
    });
  });

  var items = enriched.filter(function (market) {
    return market.priceChange != null && Math.abs(market.priceChange) >= 0.005;
  }).sort(function (a, b) {
    return Math.abs(b.priceChange) - Math.abs(a.priceChange) || b.attentionScore - a.attentionScore;
  }).map(function (market) {
    return {
      slug: market.slug,
      label: market.label,
      theme: market.theme,
      from: market.previousImpliedYes,
      to: market.impliedYes,
      change: market.priceChange,
      direction: market.priceChange > 0 ? 'up' : 'down'
    };
  });

  return {
    markets: enriched,
    changes: {
      since: previousDoc && previousDoc.generatedAt || null,
      count: items.length,
      items: items
    }
  };
}

export { enrichMarketChanges };
