import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";

const FPS = 4;

/**
 * Compile all result screenshots from a run into an MP4 video.
 * Returns the file path of the generated MP4.
 */
export async function generateRunVideo(
  screenshotDir: string,
  _runId: string,
): Promise<string | null> {
  // Collect all screenshots in order: input, per-action, then result for each turn
  const files: string[] = [];
  for (let i = 1; ; i++) {
    const resultPath = path.join(screenshotDir, `turn-${i}-result.png`);
    const hasActions = fs.existsSync(path.join(screenshotDir, `turn-${i}-action-0.png`));
    if (!resultPath || !fs.existsSync(resultPath)) {
      if (!hasActions) break;
    }

    const inputPath = path.join(screenshotDir, `turn-${i}-input.png`);
    if (fs.existsSync(inputPath)) {
      files.push(inputPath);
    }

    for (let j = 0; ; j++) {
      const actionPath = path.join(screenshotDir, `turn-${i}-action-${j}.png`);
      if (fs.existsSync(actionPath)) {
        files.push(actionPath);
      } else {
        break;
      }
    }

    if (fs.existsSync(resultPath)) {
      files.push(resultPath);
    }
  }

  if (files.length === 0) return null;

  // Write a concat list for ffmpeg
  const listPath = path.join(screenshotDir, "frames.txt");
  const listContent = files
    .map((f) => `file '${f}'\nduration ${1 / FPS}`)
    .join("\n");
  // Repeat last frame so it isn't skipped
  fs.writeFileSync(listPath, listContent + `\nfile '${files[files.length - 1]}'\n`);

  const mp4Path = path.join(screenshotDir, "run.mp4");

  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-pix_fmt", "yuv420p",
        "-movflags", "faststart",
        mp4Path,
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });

  // Cleanup temp file
  fs.unlinkSync(listPath);

  return mp4Path;
}
