export function LearnChevron({ size = 14 }: { size?: number }) {
  return (
    <span className="t-learn-chevron" aria-hidden>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
        <path className="t-learn-arm t-learn-arm-top" d="M6 4L10 8" />
        <path className="t-learn-arm t-learn-arm-bot" d="M10 8L6 12" />
      </svg>
    </span>
  );
}
