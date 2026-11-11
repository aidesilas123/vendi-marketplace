// src/lib/pricing.ts
// Single source of truth for fee math. The process-escrow edge function MUST use the same rules.
//
//   Buyer pays   = price + fee
//   Seller gets  = price - fee
//   fee          = price * platform_fee_percentage / 100   (charged separately to each side, NOT split)
//   When is_launch_promo_active is true, both fees are waived.

export type PlatformSettings =
  | { is_launch_promo_active?: boolean | null; platform_fee_percentage?: number | string | null }
  | null
  | undefined;

// Fees are whole naira, floored — the server (process-escrow /
// monnify-checkout-initialize) floors too, so the display must match
// the charge exactly. Never show fractional-naira fees.
const floorNaira = (n: number) => Math.floor(n);

export function calcFees(price: number, settings: PlatformSettings) {
  const pct = Number(settings?.platform_fee_percentage) || 0;
  const isPromo = settings ? !!settings.is_launch_promo_active : false;
  const standardFee = floorNaira((price * pct) / 100);
  const fee = isPromo ? 0 : standardFee;

  return {
    pct,
    isPromo,
    standardFee, // what the fee would be without the promo (used for the struck-through display)
    buyerFee: fee,
    sellerFee: fee,
    total: floorNaira(price + fee), // "Total due" for the buyer
    sellerPayout: floorNaira(price - fee), // what the seller can withdraw
  };
}

export const naira = (n: number) =>
  `₦${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;