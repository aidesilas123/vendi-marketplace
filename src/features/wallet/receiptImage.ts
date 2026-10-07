// src/features/wallet/receiptImage.ts
//
// Draws the receipt onto a <canvas> and shares it as a PNG.
// Canvas on purpose: no extra npm package, and it renders identically on every Android WebView
// (DOM-to-image libraries struggle with Tailwind v4's modern colour functions).

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  buildReceiptRows,
  formatNaira,
  isIncoming,
  statusMeta,
  txTitle,
  type WalletTx,
} from './txUtils';

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Watermark knobs: size of each "Vendi", spacing between them, and how faint they are (0 to 1)
const WM_SIZE = 34;
const WM_STEP_X = 210;
const WM_STEP_Y = 130;
const WM_ALPHA_CARD = 0.07;
const WM_ALPHA_PAGE = 0.05;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Tiles many small, tilted, faint "Vendi" marks across the whole canvas (staggered rows). */
function drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#F97316';
  ctx.font = `800 ${WM_SIZE}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 9);
  const reach = Math.hypot(W, H) / 2;
  let row = 0;
  for (let y = -reach; y <= reach; y += WM_STEP_Y, row++) {
    for (let x = -reach + (row % 2) * (WM_STEP_X / 2); x <= reach; x += WM_STEP_X) {
      ctx.fillText('Vendi', x, y);
    }
  }
  ctx.restore();
}

/** Shrinks the font until the text fits, then falls back to an ellipsis. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: string,
  startSize: number,
  minSize = 22
): string {
  let size = startSize;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.save();
  ctx.setLineDash([14, 12]);
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function statusGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'success' | 'pending' | 'failed',
  cx: number,
  cy: number,
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'success') {
    ctx.moveTo(cx - 24, cy + 2);
    ctx.lineTo(cx - 6, cy + 20);
    ctx.lineTo(cx + 26, cy - 18);
  } else if (kind === 'failed') {
    ctx.moveTo(cx - 20, cy - 20);
    ctx.lineTo(cx + 20, cy + 20);
    ctx.moveTo(cx + 20, cy - 20);
    ctx.lineTo(cx - 20, cy + 20);
  } else {
    ctx.moveTo(cx, cy - 26);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 18, cy + 12);
  }
  ctx.stroke();
  ctx.restore();
}

export async function renderReceiptBlob(tx: WalletTx): Promise<Blob> {
  const rows = buildReceiptRows(tx);
  const incoming = isIncoming(tx);
  const status = statusMeta(tx.status);

  const W = 1080;
  const CARD_X = 48;
  const PAD = 72;
  const innerLeft = CARD_X + PAD;
  const innerRight = W - CARD_X - PAD;
  const innerWidth = innerRight - innerLeft;
  const ROW_H = 104;
  const HEADER_H = 700;
  const FOOTER_H = 230;
  const H = HEADER_H + rows.length * ROW_H + FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create receipt image');

  // Page background + faint watermark
  ctx.fillStyle = '#FFF4EB';
  ctx.fillRect(0, 0, W, H);
  drawWatermark(ctx, W, H, WM_ALPHA_PAGE);

  // Card + watermark clipped inside it
  roundRect(ctx, CARD_X, 48, W - CARD_X * 2, H - 96, 48);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.save();
  roundRect(ctx, CARD_X, 48, W - CARD_X * 2, H - 96, 48);
  ctx.clip();
  drawWatermark(ctx, W, H, WM_ALPHA_CARD);
  ctx.restore();

  // Brand row
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#F97316';
  ctx.font = `800 58px ${FONT}`;
  ctx.fillText('Vendi', innerLeft, 168);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9CA3AF';
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText('Transaction receipt', innerRight, 166);

  // Status badge
  const cx = W / 2;
  ctx.beginPath();
  ctx.arc(cx, 318, 78, 0, Math.PI * 2);
  ctx.fillStyle = `${status.hex}1F`;
  ctx.fill();
  statusGlyph(ctx, status.kind, cx, 318, status.hex);

  // Amount + title
  ctx.textAlign = 'center';
  ctx.fillStyle = incoming ? '#16A34A' : '#111827';
  ctx.font = `800 92px ${FONT}`;
  ctx.fillText(`${incoming ? '+' : '-'}${formatNaira(tx.amount)}`, cx, 488);

  ctx.fillStyle = '#6B7280';
  const title = fitText(ctx, txTitle(tx), innerWidth, '600', 34, 24);
  ctx.fillText(title, cx, 548);

  // Status pill
  ctx.font = `700 28px ${FONT}`;
  const pillText = status.label;
  const pillW = ctx.measureText(pillText).width + 56;
  roundRect(ctx, cx - pillW / 2, 584, pillW, 56, 28);
  ctx.fillStyle = `${status.hex}1F`;
  ctx.fill();
  ctx.fillStyle = status.hex;
  ctx.fillText(pillText, cx, 622);

  dashedLine(ctx, innerLeft, innerRight, HEADER_H - 10);

  // Detail rows
  let y = HEADER_H + 62;
  for (const row of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9CA3AF';
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(row.label, innerLeft, y);
    const labelW = ctx.measureText(row.label).width;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#111827';
    const value = fitText(ctx, row.value, innerWidth - labelW - 48, '600', 32, 22);
    ctx.fillText(value, innerRight, y);
    y += ROW_H;
  }

  dashedLine(ctx, innerLeft, innerRight, y - 34);

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6B7280';
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText('Thank you for using Vendi', cx, y + 34);
  ctx.fillStyle = '#9CA3AF';
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText(`Generated ${new Date().toLocaleString('en-NG')}`, cx, y + 78);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create receipt image'))), 'image/png');
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read receipt image'));
    reader.readAsDataURL(blob);
  });
}

/** Renders the receipt and opens the share sheet. Rejects with a "cancel" message if dismissed. */
export async function shareReceiptImage(tx: WalletTx): Promise<void> {
  const blob = await renderReceiptBlob(tx);
  const stamp = String(tx.reference ?? tx.id).replace(/[^a-zA-Z0-9-]/g, '').slice(-14) || 'receipt';
  const fileName = `vendi-receipt-${stamp}.png`;
  const text = `Vendi receipt · ${formatNaira(tx.amount)}`;

  if (Capacitor.isNativePlatform()) {
    const data = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    await Share.share({ title: 'Vendi receipt', text, files: [uri], dialogTitle: 'Share receipt' });
    return;
  }

  const file = new File([blob], fileName, { type: 'image/png' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Vendi receipt', text });
    return;
  }

  // Desktop browsers: download the image instead
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}