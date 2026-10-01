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

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcFees(price: number, settings: PlatformSettings) {
  const pct = Number(settings?.platform_fee_percentage) || 0;
  const isPromo = settings ? !!settings.is_launch_promo_active : false;
  const standardFee = round2((price * pct) / 100);
  const fee = isPromo ? 0 : standardFee;

  return {
    pct,
    isPromo,
    standardFee, // what the fee would be without the promo (used for the struck-through display)
    buyerFee: fee,
    sellerFee: fee,
    total: round2(price + fee), // "Total due" for the buyer
    sellerPayout: round2(price - fee), // what the seller can withdraw
  };
}

export const naira = (n: number) =>
  `₦${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;