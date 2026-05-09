import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createMuppetEngine, type MuppetController, type MuppetSayOptions } from "./muppet-engine";
import "./muppet-stage.css";

export type MuppetStageHandle = {
  say(opts: MuppetSayOptions): Promise<void>;
  setExpression: MuppetController["setExpression"];
  playGesture: MuppetController["playGesture"];
  setVoiceProfile: MuppetController["setVoiceProfile"];
  setCharacter: MuppetController["setCharacter"];
  panicStop: MuppetController["panicStop"];
  unlockSpeech: MuppetController["unlockSpeech"];
};

type Props = {
  className?: string;
  ariaLabel?: string;
};

export const MuppetStage = forwardRef<MuppetStageHandle, Props>(function MuppetStage(
  { className, ariaLabel = "Officer stage" },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<MuppetController | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const c = createMuppetEngine(canvasRef.current);
    controllerRef.current = c;
    return () => {
      c.dispose();
      controllerRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      say: (opts) => controllerRef.current?.say(opts) ?? Promise.resolve(),
      setExpression: (e) => controllerRef.current?.setExpression(e),
      playGesture: (g) => controllerRef.current?.playGesture(g),
      setVoiceProfile: (o) => controllerRef.current?.setVoiceProfile(o),
      setCharacter: (c) => controllerRef.current?.setCharacter(c),
      panicStop: () => controllerRef.current?.panicStop(),
      unlockSpeech: () => controllerRef.current?.unlockSpeech(),
    }),
    [],
  );

  return (
    <div className={`muppet-stage ${className ?? ""}`} aria-label={ariaLabel}>
      <canvas ref={canvasRef} className="muppet-canvas" />
    </div>
  );
});
