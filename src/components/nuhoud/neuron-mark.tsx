/** The Nuhoud mark: a joint (centre) with its range of motion. Colour comes from currentColor. */
export function NeuronMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Nuhoud logo" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
        <path d="M32 4 L32 12" /><path d="M52 16 L46 21" /><path d="M60 32 L52 32" /><path d="M52 48 L46 43" /><path d="M32 60 L32 52" /><path d="M12 48 L18 43" /><path d="M4 32 L12 32" /><path d="M12 16 L18 21" />
      </g>
      <circle cx="32" cy="32" r="6" fill="currentColor" />
      <path d="M20 40 Q32 50 44 36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <circle cx="20" cy="40" r="3" fill="currentColor" />
      <circle cx="44" cy="36" r="3" fill="currentColor" />
    </svg>
  )
}
