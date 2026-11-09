// src/shared/Icon/VanIcon.tsx
// A delivery van icon. Ionicons ships no van (only car/bus), and a van is the
// clearest "delivery" symbol, so this is a small custom outline icon drawn
// in the same style (stroke, round caps) so it sits cleanly next to Ionicons.

export function VanIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 6h12v10H2z" />
      <path d="M14 10h3.6L21 13.4V16h-7" />
      <circle cx="6.5" cy="17.5" r="1.7" />
      <circle cx="17" cy="17.5" r="1.7" />
    </svg>
  );
}
