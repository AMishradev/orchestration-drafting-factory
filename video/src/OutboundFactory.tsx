import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { theme } from "./theme";
import {
  TitleScene,
  PipelineScene,
  ResearchScene,
  LoopScene,
  SendScene,
  OutroScene,
} from "./Scenes";

export const OutboundFactory: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.sans }}>
      <Sequence durationInFrames={150}>
        <TitleScene />
      </Sequence>
      <Sequence from={150} durationInFrames={270}>
        <PipelineScene />
      </Sequence>
      <Sequence from={420} durationInFrames={240}>
        <ResearchScene />
      </Sequence>
      <Sequence from={660} durationInFrames={480}>
        <LoopScene />
      </Sequence>
      <Sequence from={1140} durationInFrames={300}>
        <SendScene />
      </Sequence>
      <Sequence from={1440} durationInFrames={120}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};
