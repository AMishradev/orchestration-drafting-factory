import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "./theme";
import { Background, Badge, Panel, useEnter } from "./ui";
import { Pipeline, ReviseLoop } from "./Pipeline";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---------- Scene 1: Title ----------
export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const sub = useEnter(18);
  const chip = useEnter(34);
  const out = interpolate(frame, [120, 150], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <Background />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
        }}
      >
        <div style={{ transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)`, opacity: s }}>
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 26,
              letterSpacing: 8,
              color: theme.accent,
              textAlign: "center",
              marginBottom: 18,
            }}
          >
            AGENT ORCHESTRATION · DRAFTING FACTORY
          </div>
          <div
            style={{
              fontFamily: theme.sans,
              fontSize: 108,
              fontWeight: 800,
              letterSpacing: -2,
              color: theme.text,
              textAlign: "center",
              lineHeight: 1.02,
              textShadow: `0 0 60px ${theme.accentGlow}`,
            }}
          >
            Outbound Factory
          </div>
        </div>
        <div
          style={{
            ...sub,
            fontFamily: theme.sans,
            fontSize: 34,
            color: theme.textDim,
            textAlign: "center",
            maxWidth: 1100,
            lineHeight: 1.4,
          }}
        >
          A multi-agent workflow with a real-time feedback loop — research,
          drafting, review, and critique over a persistent WebSocket.
        </div>
        <div style={{ ...chip, display: "flex", gap: 16, marginTop: 8 }}>
          <Badge color={theme.cyan} label="Bun" />
          <Badge color={theme.accent} label="TypeScript" />
          <Badge color={theme.purple} label="Zod contracts" />
          <Badge color={theme.green} label="Pi + Composio" />
        </div>
      </div>
    </div>
  );
};

// ---------- Scene 2: Pipeline overview ----------
export const PipelineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const head = useEnter(6);
  const activeIndex = interpolate(frame, [30, 200], [-0.5, 6.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const loopOpacity = interpolate(frame, [150, 185], [0, 1], { extrapolateLeft: "clamp" });
  const out = interpolate(frame, [240, 270], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <Background />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
        }}
      >
        <div style={{ ...head, textAlign: "center" }}>
          <div
            style={{
              fontFamily: theme.sans,
              fontSize: 56,
              fontWeight: 700,
              color: theme.text,
            }}
          >
            One workflow. Seven stages.
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 28, color: theme.textDim, marginTop: 10 }}>
            Every hand-off is a Zod-validated contract streamed over WebSocket.
          </div>
        </div>
        <Pipeline activeIndex={activeIndex} scale={0.92} />
        <div style={{ height: 120, marginTop: -10 }}>
          <ReviseLoop opacity={loopOpacity} />
        </div>
      </div>
    </div>
  );
};

// ---------- Reusable rail (compact pipeline on top) ----------
const Rail: React.FC<{ activeIndex: number }> = ({ activeIndex }) => (
  <div style={{ transform: "scale(0.62)", transformOrigin: "top center" }}>
    <Pipeline activeIndex={activeIndex} />
  </div>
);

const Typed: React.FC<{ text: string; start: number; cps?: number; style?: React.CSSProperties }> = ({
  text,
  start,
  cps = 42,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = Math.floor(clamp01((frame - start) / fps) * cps);
  const shown = text.slice(0, chars);
  const done = chars >= text.length;
  return (
    <span style={style}>
      {shown}
      {!done && chars > 0 ? <span style={{ opacity: (frame % 16) < 8 ? 1 : 0 }}>▌</span> : null}
    </span>
  );
};

// ---------- Scene 3: Request + Research ----------
export const ResearchScene: React.FC = () => {
  const frame = useCurrentFrame();
  const req = useEnter(10);
  const arrow = interpolate(frame, [60, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sig = useEnter(95);
  const conf = useEnter(120);
  const confVal = interpolate(frame, [120, 160], [0, 0.94], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const out = interpolate(frame, [210, 240], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <Background />
      <div style={{ position: "absolute", top: 54, width: "100%", display: "flex", justifyContent: "center" }}>
        <Rail activeIndex={0} />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          top: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 70,
        }}
      >
        <Panel style={{ ...req, width: 560, padding: 40 }} glow={theme.accentGlow}>
          <Badge color={theme.accent} label="POST /workflows" />
          <div style={{ marginTop: 26, fontFamily: theme.mono, fontSize: 27, lineHeight: 1.9, color: theme.text }}>
            <div><span style={{ color: theme.textDim }}>company</span> : Acme</div>
            <div><span style={{ color: theme.textDim }}>domain&nbsp;&nbsp;</span>: acme.example</div>
            <div><span style={{ color: theme.textDim }}>prospect</span>: Maya</div>
            <div><span style={{ color: theme.textDim }}>title&nbsp;&nbsp;&nbsp;</span>: VP of Sales</div>
          </div>
        </Panel>

        <div style={{ width: 90, height: 4, position: "relative" }}>
          <div style={{ position: "absolute", height: 4, width: "100%", background: theme.panelBorder, borderRadius: 4 }} />
          <div
            style={{
              position: "absolute",
              height: 4,
              width: `${arrow * 100}%`,
              background: theme.cyan,
              borderRadius: 4,
              boxShadow: `0 0 12px ${theme.cyan}`,
            }}
          />
        </div>

        <Panel style={{ ...sig, width: 620, padding: 40 }} glow="rgba(34,211,238,0.35)">
          <Badge color={theme.cyan} label="research.signal.available" />
          <div style={{ marginTop: 24, fontFamily: theme.sans, fontSize: 32, fontWeight: 600, color: theme.text, lineHeight: 1.35 }}>
            “Acme launched a new enterprise offering”
          </div>
          <div style={{ marginTop: 14, fontFamily: theme.mono, fontSize: 22, color: theme.textDim }}>
            acme.example/news/enterprise
          </div>
          <div style={{ ...conf, marginTop: 30 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: theme.mono, fontSize: 22, color: theme.textDim, marginBottom: 8 }}>
              <span>confidence</span>
              <span style={{ color: theme.cyan }}>{confVal.toFixed(2)}</span>
            </div>
            <div style={{ height: 12, borderRadius: 8, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${confVal * 100}%`, background: `linear-gradient(90deg, ${theme.cyan}, ${theme.accent})`, boxShadow: `0 0 16px ${theme.cyan}` }} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};

// ---------- Draft attempt card ----------
type Verdict = {
  kind: "revise" | "approve";
  stage: string;
  code?: string;
  message: string;
};

const AttemptCard: React.FC<{
  attempt: number;
  bodyLines: { text: string; bad?: boolean }[];
  verdict: Verdict;
  startFrame: number;
}> = ({ attempt, bodyLines, verdict, startFrame }) => {
  const frame = useCurrentFrame();
  const enter = useEnter(startFrame);
  const verdictColor = verdict.kind === "approve" ? theme.green : theme.amber;
  const verdictGlow = verdict.kind === "approve" ? theme.greenGlow : theme.amberGlow;
  const stampIn = spring({
    frame: frame - (startFrame + 55),
    fps: 30,
    config: { damping: 12, stiffness: 140, mass: 0.7 },
  });
  return (
    <Panel style={{ ...enter, width: 760, padding: 36 }} glow={verdictGlow}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Badge color={theme.accent} label={`drafting · attempt ${attempt}`} />
        <span style={{ fontFamily: theme.mono, fontSize: 20, color: theme.textFaint }}>
          revision {attempt}
        </span>
      </div>
      <div
        style={{
          marginTop: 24,
          padding: "22px 26px",
          borderRadius: 14,
          background: "rgba(0,0,0,0.28)",
          border: `1px solid ${theme.panelBorder}`,
          fontFamily: theme.sans,
          fontSize: 26,
          lineHeight: 1.55,
          color: theme.text,
        }}
      >
        {bodyLines.map((l, i) => (
          <div
            key={i}
            style={{
              color: l.bad ? theme.red : theme.text,
              background: l.bad ? "rgba(248,113,113,0.14)" : "transparent",
              borderRadius: 6,
              padding: l.bad ? "2px 6px" : 0,
              display: l.bad ? "inline-block" : "block",
              margin: l.bad ? "4px 0" : 0,
            }}
          >
            {l.text}
          </div>
        ))}
      </div>

      <div
        style={{
          position: "relative",
          marginTop: 24,
          padding: "20px 24px",
          borderRadius: 14,
          border: `1.5px solid ${verdictColor}66`,
          background: `${verdictColor}12`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Badge
            color={verdictColor}
            label={`${verdict.stage} · ${verdict.kind}`}
            glow={verdictGlow}
          />
          {verdict.code && (
            <span style={{ fontFamily: theme.mono, fontSize: 20, color: verdictColor, fontWeight: 700 }}>
              {verdict.code}
            </span>
          )}
        </div>
        <div style={{ marginTop: 14, fontFamily: theme.sans, fontSize: 24, color: theme.textDim, lineHeight: 1.4 }}>
          {verdict.message}
        </div>
        <div
          style={{
            position: "absolute",
            top: -22,
            right: 28,
            transform: `scale(${stampIn}) rotate(-8deg)`,
            fontFamily: theme.mono,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 1,
            color: verdictColor,
            border: `3px solid ${verdictColor}`,
            borderRadius: 10,
            padding: "4px 16px",
            background: theme.bg,
            boxShadow: `0 0 30px ${verdictGlow}`,
          }}
        >
          {verdict.kind === "approve" ? "APPROVED" : "REVISE"}
        </div>
      </div>
    </Panel>
  );
};

// ---------- Scene 4: Feedback loop (3 attempts) ----------
export const LoopScene: React.FC = () => {
  const frame = useCurrentFrame();
  // Rail progresses across drafting/review/critic as attempts play.
  const activeIndex = interpolate(
    frame,
    [0, 150, 300, 430],
    [1, 2, 3, 4.5],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const out = interpolate(frame, [450, 480], [1, 0], { extrapolateLeft: "clamp" });

  // Horizontal slide between the three attempt cards.
  const slide = interpolate(
    frame,
    [130, 160, 280, 310],
    [0, -1, -1, -2],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <Background />
      <div style={{ position: "absolute", top: 54, width: "100%", display: "flex", justifyContent: "center" }}>
        <Rail activeIndex={activeIndex} />
      </div>
      <div style={{ position: "absolute", top: 140, width: "100%", textAlign: "center", fontFamily: theme.sans, fontSize: 30, color: theme.textDim }}>
        Same drafting session. Every verdict routes straight back.
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          top: 200,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 120,
            transform: `translateX(${slide * 880}px)`,
            width: 760,
          }}
        >
          <div style={{ flex: "0 0 760px" }}>
            <AttemptCard
              attempt={1}
              startFrame={10}
              bodyLines={[
                { text: "Hi Maya, I noticed Acme launched a new enterprise offering." },
                { text: "I saw you're hiring 200 sales reps this quarter.", bad: true },
              ]}
              verdict={{
                kind: "revise",
                stage: "review",
                code: "UNSUPPORTED_CLAIM",
                message: "The hiring claim has no supporting research signal. Use only sourced evidence.",
              }}
            />
          </div>
          <div style={{ flex: "0 0 760px" }}>
            <AttemptCard
              attempt={2}
              startFrame={150}
              bodyLines={[
                { text: "Hi Maya, I noticed Acme launched a new enterprise offering." },
                { text: "Seemed only fair to reach out about it.", bad: true },
              ]}
              verdict={{
                kind: "revise",
                stage: "critic",
                code: "FORBIDDEN_WORD_FAIR",
                message: 'Deterministic policy forbids the standalone word "fair". Rewrite it.',
              }}
            />
          </div>
          <div style={{ flex: "0 0 760px" }}>
            <AttemptCard
              attempt={3}
              startFrame={300}
              bodyLines={[
                { text: "Hi Maya, I noticed Acme launched a new enterprise offering." },
                { text: "We help VP of Sales leaders turn signals like that into focused outbound." },
                { text: "Worth comparing notes?" },
              ]}
              verdict={{
                kind: "approve",
                stage: "critic",
                message: "The revised email is concise, specific, and fully sourced.",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- Scene 5: Send / Sent ----------
export const SendScene: React.FC = () => {
  const frame = useCurrentFrame();
  const card = useEnter(20);
  const out = interpolate(frame, [270, 300], [1, 0], { extrapolateLeft: "clamp" });
  const events = [
    "deep_review → approve",
    "send.recipient.resolved",
    "send.dm.opened",
    "send.message.sent",
    "workflow.sent",
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <Background />
      <div style={{ position: "absolute", top: 54, width: "100%", display: "flex", justifyContent: "center" }}>
        <Rail activeIndex={6} />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          top: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {events.map((e, i) => {
            const en = spring({ frame: frame - (20 + i * 16), fps: 30, config: { damping: 200 } });
            return (
              <div
                key={e}
                style={{
                  opacity: en,
                  transform: `translateX(${interpolate(en, [0, 1], [-30, 0])}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  fontFamily: theme.mono,
                  fontSize: 24,
                  color: i === events.length - 1 ? theme.green : theme.textDim,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 999, background: theme.green, boxShadow: `0 0 10px ${theme.green}` }} />
                {e}
              </div>
            );
          })}
        </div>

        <Panel style={{ ...card, width: 720, padding: 0, overflow: "hidden" }} glow={theme.greenGlow}>
          <div style={{ padding: "18px 26px", background: "rgba(74,222,128,0.10)", borderBottom: `1px solid ${theme.panelBorder}`, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>💬</span>
            <span style={{ fontFamily: theme.sans, fontWeight: 700, fontSize: 24, color: theme.text }}>Slack DM · Archit</span>
            <span style={{ marginLeft: "auto" }}><Badge color={theme.green} label="delivered" glow={theme.greenGlow} /></span>
          </div>
          <div style={{ padding: 30, fontFamily: theme.sans, fontSize: 24, lineHeight: 1.5, color: theme.text }}>
            <div style={{ color: theme.textDim, fontFamily: theme.mono, fontSize: 20 }}>## Outbound email</div>
            <div style={{ marginTop: 14 }}><b>To:</b> Maya, VP of Sales at Acme</div>
            <div><b>Subject:</b> Acme's enterprise launch</div>
            <div style={{ marginTop: 16, borderLeft: `3px solid ${theme.green}66`, paddingLeft: 16, color: theme.textDim }}>
              Hi Maya,<br />
              I noticed Acme launched a new enterprise offering.<br />
              We help VP of Sales leaders turn signals like that into focused outbound.<br />
              Worth comparing notes?
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};

// ---------- Scene 6: Outro / result summary ----------
export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: 30, config: { damping: 200 } });
  const stats = [
    { k: "status", v: "sent", c: theme.green },
    { k: "draftAttempt", v: "3", c: theme.accent },
    { k: "delivery", v: "simulated", c: theme.cyan },
  ];
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Background />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 44 }}>
        <div style={{ opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.9, 1])})`, fontFamily: theme.sans, fontSize: 84, fontWeight: 800, color: theme.text, textShadow: `0 0 50px ${theme.greenGlow}` }}>
          ✓ Workflow complete
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          {stats.map((st, i) => {
            const en = spring({ frame: frame - (20 + i * 12), fps: 30, config: { damping: 200 } });
            return (
              <Panel key={st.k} style={{ opacity: en, transform: `translateY(${interpolate(en, [0, 1], [24, 0])}px)`, padding: "26px 40px", textAlign: "center" }}>
                <div style={{ fontFamily: theme.mono, fontSize: 22, color: theme.textDim, marginBottom: 10 }}>{st.k}</div>
                <div style={{ fontFamily: theme.mono, fontSize: 40, fontWeight: 700, color: st.c }}>{st.v}</div>
              </Panel>
            );
          })}
        </div>
        <div style={{ opacity: interpolate(frame, [50, 80], [0, 1], { extrapolateLeft: "clamp" }), fontFamily: theme.mono, fontSize: 26, color: theme.textFaint, marginTop: 10 }}>
          github.com/AMishradev/orchestration-drafting-factory
        </div>
      </div>
    </div>
  );
};
