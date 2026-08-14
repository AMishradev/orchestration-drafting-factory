import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "./theme";

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 40;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(1200px 800px at ${50 + drift / 10}% 12%, #16203a 0%, ${theme.bg} 55%, #070a12 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(circle at 50% 40%, black, transparent 78%)",
        }}
      />
    </div>
  );
};

// Fade + slight rise, driven by a spring that starts at `delay`.
export const useEnter = (delay: number, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping, mass: 0.9, stiffness: 120 },
  });
  return {
    opacity: interpolate(s, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`,
    s,
  };
};

export const Panel: React.FC<{
  style?: React.CSSProperties;
  glow?: string;
  children: React.ReactNode;
}> = ({ style, glow, children }) => (
  <div
    style={{
      background: `linear-gradient(180deg, ${theme.panel} 0%, ${theme.bg2} 100%)`,
      border: `1px solid ${theme.panelBorder}`,
      borderRadius: 20,
      boxShadow: glow
        ? `0 0 0 1px ${glow}, 0 24px 70px -20px ${glow}, 0 20px 60px -30px rgba(0,0,0,0.8)`
        : "0 20px 60px -30px rgba(0,0,0,0.8)",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Badge: React.FC<{ color: string; label: string; glow?: string }> = ({
  color,
  label,
  glow,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 14px",
      borderRadius: 999,
      fontFamily: theme.mono,
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: 0.4,
      color,
      background: `${color}1a`,
      border: `1px solid ${color}55`,
      boxShadow: glow ? `0 0 24px ${glow}` : "none",
    }}
  >
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 10px ${color}`,
      }}
    />
    {label}
  </span>
);
