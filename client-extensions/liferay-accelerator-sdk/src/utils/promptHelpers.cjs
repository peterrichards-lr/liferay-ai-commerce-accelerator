function pluralize(count, singular = '', plural = 's') {
  return count === 1 ? singular : plural;
}

function pricingHints(pricingType = 'standard') {
  const base = {
    bulkHint: '',
    tierHint: '',
    promoHint: '',
  };

  if (pricingType === 'bulk') {
    base.bulkHint =
      'Include 2–4 bulk tiers (e.g., 10/50/100 units) with rising discounts.';
  }
  if (pricingType === 'tier') {
    base.tierHint =
      'Include 2–3 customer tiers (e.g., Standard, Gold, Enterprise) with sensible price deltas.';
  }
  if (pricingType === 'promotional') {
    base.promoHint =
      'Include a short-term promo (percentage or fixed amount) with realistic dates.';
  }
  return base;
}

function joinList(list, sep = ', ') {
  return Array.isArray(list) ? list.join(sep) : String(list ?? '');
}

module.exports = { pluralize, pricingHints, joinList };
