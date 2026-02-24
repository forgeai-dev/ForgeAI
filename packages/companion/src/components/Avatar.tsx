// Avatar component — no React hooks needed, pure CSS animations

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AvatarProps {
  state: AvatarState;
  size?: number;
  onClick?: () => void;
}

export function Avatar({ state, size = 64, onClick }: AvatarProps) {
  const stateColors: Record<AvatarState, { bg: string; ring: string; glow: string; icon: string }> = {
    idle: {
      bg: 'from-indigo-600 to-violet-600',
      ring: 'border-indigo-400/30',
      glow: 'shadow-indigo-500/20',
      icon: '#a5b4fc',
    },
    listening: {
      bg: 'from-emerald-500 to-teal-600',
      ring: 'border-emerald-400/50',
      glow: 'shadow-emerald-500/30',
      icon: '#6ee7b7',
    },
    thinking: {
      bg: 'from-amber-500 to-orange-600',
      ring: 'border-amber-400/50',
      glow: 'shadow-amber-500/30',
      icon: '#fcd34d',
    },
    speaking: {
      bg: 'from-cyan-500 to-blue-600',
      ring: 'border-cyan-400/50',
      glow: 'shadow-cyan-500/30',
      icon: '#67e8f9',
    },
  };

  const colors = stateColors[state];

  return (
    <div
      className={`relative flex items-center justify-center cursor-pointer select-none w-[${size}px] h-[${size}px]`}
      onClick={onClick}
      title={`ForgeAI — ${state}`}
    >
      {/* Outer pulse ring */}
      {state === 'listening' && (
        <>
          <div
            className={`absolute inset-0 rounded-full border-2 ${colors.ring} animate-pulse-ring avatar-ring-fast`}
          />
          <div
            className={`absolute inset-0 rounded-full border ${colors.ring} animate-pulse-ring avatar-ring-slow`}
          />
        </>
      )}

      {/* Thinking spinner */}
      {state === 'thinking' && (
        <div className="absolute inset-[-4px]">
          <svg className="w-full h-full animate-spin avatar-spin-slow" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke="url(#thinkGrad)"
              strokeWidth="2"
              strokeDasharray="60 200"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="thinkGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      )}

      {/* Speaking sound waves */}
      {state === 'speaking' && (
        <div className="absolute inset-[-6px] flex items-center justify-center">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`absolute rounded-full border border-cyan-400/30 avatar-wave-${i}`}
            />
          ))}
        </div>
      )}

      {/* Main avatar circle */}
      <div
        className={`relative w-full h-full rounded-full bg-gradient-to-br ${colors.bg} shadow-lg ${colors.glow} flex items-center justify-center transition-all duration-300 ${state === 'idle' ? 'animate-float' : ''}`}
      >
        {/* Core icon — sparkle/AI symbol */}
        <svg
          width={size * 0.45}
          height={size * 0.45}
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.icon}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={state === 'thinking' ? 'animate-pulse' : ''}
        >
          {state === 'listening' ? (
            // Microphone icon when listening
            <>
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </>
          ) : state === 'speaking' ? (
            // Sound wave icon when speaking
            <>
              <path d="M2 10v3" />
              <path d="M6 6v11" />
              <path d="M10 3v18" />
              <path d="M14 8v7" />
              <path d="M18 5v13" />
              <path d="M22 10v3" />
            </>
          ) : (
            // Sparkle icon for idle/thinking
            <>
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              <path d="M20 3v4" />
              <path d="M22 5h-4" />
            </>
          )}
        </svg>
      </div>

      {/* State label */}
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${
          state === 'idle' ? 'text-zinc-500' :
          state === 'listening' ? 'bg-emerald-500/10 text-emerald-400' :
          state === 'thinking' ? 'bg-amber-500/10 text-amber-400' :
          'bg-cyan-500/10 text-cyan-400'
        }`}>
          {state === 'idle' ? '' :
           state === 'listening' ? 'Listening...' :
           state === 'thinking' ? 'Thinking...' :
           'Speaking...'}
        </span>
      </div>
    </div>
  );
}
