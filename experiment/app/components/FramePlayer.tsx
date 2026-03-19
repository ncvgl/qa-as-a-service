"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Props = {
  frames: string[]; // ordered screenshot URLs
  videoUrl?: string | null;
};

const FPS = 6;
const FRAME_INTERVAL = Math.round(1000 / FPS);

export default function FramePlayer({ frames, videoUrl }: Props) {
  const [currentFrame, setCurrentFrame] = useState(Math.min(2, frames.length - 1));
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = frames.length;

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stop();
    setPlaying(true);
    // If at the end, restart from beginning
    setCurrentFrame((prev) => (prev >= total - 1 ? 0 : prev));
    timerRef.current = setInterval(() => {
      setCurrentFrame((prev) => {
        if (prev >= total - 1) {
          // Reached end — stop
          setTimeout(stop, 0);
          return prev;
        }
        return prev + 1;
      });
    }, FRAME_INTERVAL);
  }, [total, stop]);

  const togglePlay = useCallback(() => {
    if (playing) {
      stop();
    } else {
      play();
    }
  }, [playing, play, stop]);

  const stepBack = useCallback(() => {
    stop();
    setCurrentFrame((prev) => Math.max(0, prev - 1));
  }, [stop]);

  const stepForward = useCallback(() => {
    stop();
    setCurrentFrame((prev) => Math.min(total - 1, prev + 1));
  }, [total, stop]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stop();
      setCurrentFrame(Number(e.target.value));
    },
    [stop],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (total === 0) return null;

  return (
    <div className="frame-player">
      {/* Frame display */}
      <div className="frame-player-viewport">
        <img
          className="frame-player-img"
          src={frames[currentFrame]}
          alt={`Frame ${currentFrame + 1} of ${total}`}
        />
      </div>

      {/* Controls */}
      <div className="frame-player-controls">
        <button className="frame-player-btn" onClick={stepBack} disabled={currentFrame === 0}>
          &#8249;
        </button>
        <button className="frame-player-btn frame-player-btn-play" onClick={togglePlay}>
          {playing ? "\u23F8" : "\u25B6"}
        </button>
        <button className="frame-player-btn" onClick={stepForward} disabled={currentFrame >= total - 1}>
          &#8250;
        </button>

        {/* Scrub bar */}
        <input
          className="frame-player-scrub"
          type="range"
          min={0}
          max={total - 1}
          value={currentFrame}
          onChange={handleScrub}
        />

        {/* Frame counter */}
        <span className="frame-player-counter">
          {currentFrame + 1} / {total}
        </span>

        {/* Download MP4 */}
        {videoUrl && (
          <button
            className="frame-player-btn frame-player-download"
            title="Download MP4"
            onClick={async () => {
              const res = await fetch(videoUrl);
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "run.mp4";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            &#8595;
          </button>
        )}
      </div>
    </div>
  );
}
