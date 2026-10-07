export const SuccessCheck = ({ size = 14 }: { size?: number }) => (
  <span className="t-success-check" data-state="in" aria-hidden>
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" pathLength={20} />
    </svg>
  </span>
);
