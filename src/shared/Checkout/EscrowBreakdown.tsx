// src/shared/Checkout/EscrowBreakdown.tsx
import React from 'react';
import { calcFees, naira } from '@/lib/pricing';

type Fees = ReturnType<typeof calcFees>;

export function EscrowBreakdown({
  priceLabel = 'Item price',
  price,
  fees,
}: {
  priceLabel?: string;
  price: number;
  fees: Fees;
}) {
  return (
    <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 p-4 text-left">
      <p className="mb-3 text-center text-xs font-black uppercase tracking-[0.2em] text-[#D4AF37]">
        Escrow Breakdown
      </p>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{priceLabel}</span>
          <span className="font-bold">{naira(price)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500">Platform fee ({fees.pct}%)</span>
          {fees.isPromo ? (
            <span className="flex items-center gap-2">
              <s className="text-gray-400">{naira(fees.standardFee)}</s>
              <span className="font-bold text-green-600">Free</span>
            </span>
          ) : (
            <span className="font-bold">{naira(fees.buyerFee)}</span>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#D4AF37]/20 pt-2">
          <span className="font-black">Total due</span>
          <span className="text-base font-black text-orange-500">{naira(fees.total)}</span>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        {fees.isPromo
          ? 'Launch promo: no platform fee on this transaction.'
          : `${fees.pct}% platform fee is added to this transaction.`}
      </p>
    </div>
  );
}