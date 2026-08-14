import { Composition } from "remotion";
import { OutboundFactory } from "./OutboundFactory";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OutboundFactory"
      component={OutboundFactory}
      durationInFrames={1560}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
