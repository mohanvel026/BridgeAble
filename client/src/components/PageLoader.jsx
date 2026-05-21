// client/src/components/PageLoader.jsx
// Week 10 — Full-page loading state with accessible announcement

export default function PageLoader({ message = 'Loading...' }) {
  return (
    <div
      className="min-h-screen bg-mesh-dark flex flex-col items-center justify-center gap-4"
      role="status"
      aria-label={message}
      aria-live="polite">

      {/* Animated logo */}
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-cyan to-accent-teal
                         flex items-center justify-center text-dark-950 font-bold text-2xl
                         shadow-glow animate-float">
          B
        </div>
        <div className="absolute -inset-2 rounded-3xl border-2 border-accent-cyan/20 animate-ping" />
      </div>

      {/* Spinner */}
      <div className="w-8 h-8 border-2 border-accent-cyan/20 border-t-accent-cyan
                       rounded-full animate-spin" />

      <p className="text-text-secondary text-sm">{message}</p>
    </div>
  );
}