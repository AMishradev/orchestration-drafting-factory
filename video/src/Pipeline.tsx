import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { theme } from "./theme";

export const STAGES = [
  { key: "research", label: "research", color: theme.cyan },
  { key: "drafting", label: "drafting", color: theme.accent },
  { key: "review", label: "review", color: theme.purple },
  { key: "critic", label: "critic", color: theme.amber },
  { key: "deep", label: "deep review", color: theme.purple },
  { key: "send", label: "send", color: theme.green },
  { key: "sent", label: "sent", color: theme.green },
];

const Node: React.FC<{
  label: string;
  color: string;
  active: number; // 0..1 activation
  done: boolean;
}> = ({ label, color, active, done }) => {
  const c = done ? theme.green : color;
  return (
    <div
      style={{
        position: "relative",
        padding: "16px 26px",
        borderRadius: 14,
        fontFamily: theme.mono,
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        color: interpolate(active, [0, 1], [0.55, 1]) > 0.8 ? c : theme.textDim,
        background: `linear-gradient(180deg, ${theme.panel}, ${theme.bg2})`,
        border: `1.5px solid ${active > 0.05 ? c : theme.panelBorder}`,
        boxShadow:
          active > 0.05
            ? `0 0 ${28 * active}px ${c}66, inset 0 0 20px ${c}18`
            : "none",
        transform: `scale(${interpolate(active, [0, 1], [0.96, 1])})`,
        transition: "none",
      }}
    >
      {label}
    </div>
  );
};

const Arrow: React.FC<{ progress: number; color: string }> = ({ progress, color }) => (
  <div style={{ position: "relative", width: 46, height: 4 }}>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        height: 4,
        borderRadius: 4,
        width: `${100 * progress}%`,
        background: color,
        boxShadow: `0 0 10px ${color}`,
      }}
    />
    <div
      style={{
        position: "absolute",
        top: 0,
        width: "100%",
        height: 4,
        borderRadius: 4,
        background: theme.panelBorder,
        zIndex: -1,
      }}
    />
  </div>
);

// activeIndex: which stage is currently lit (fractional allowed). scale controls size.
export const Pipeline: React.FC<{
  activeIndex: number;
  scale?: number;
}> = ({ activeIndex, scale = 1 }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        transform: `scale(${scale})`,
      }}
    >
      {STAGES.map((st, i) => {
        const active = interpolate(activeIndex, [i - 0.5, i], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const done = activeIndex > i + 0.5;
        return (
          <React.Fragment key={st.key}>
            <Node label={st.label} color={st.color} active={active} done={done} />
            {i < STAGES.length - 1 && (
              <Arrow
                color={done ? theme.green : st.color}
                progress={interpolate(activeIndex, [i, i + 0.5], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// The revise feedback loop arc under drafting/review/critic.
export const ReviseLoop: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const dash = -(frame * 1.4) % 24;
  return (
    <svg width={620} height={120} style={{ opacity }}>
      <defs>
        <marker
          id="rev-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill={theme.amber} />
        </marker>
      </defs>
      <path
        d="M 560 12 C 560 90, 60 90, 60 20"
        fill="none"
        stroke={theme.amber}
        strokeWidth={3}
        strokeDasharray="10 14"
        strokeDashoffset={dash}
        markerEnd="url(#rev-arrow)"
        opacity={0.9}
      />
      <text
        x={310}
        y={108}
        textAnchor="middle"
        fill={theme.amber}
        fontFamily={theme.mono}
        fontSize={22}
        fontWeight={600}
      >
        revise → route back to same drafting session
      </text>
    </svg>
  );
};
