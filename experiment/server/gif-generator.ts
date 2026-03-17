import * as fs from "node:fs";
import * as path from "node:path";
import { PNG } from "pngjs";
import GIFEncoder from "gif-encoder-2";

const FRAME_DELAY_MS = 250; // 4 fps = 250ms per frame

/**
 * Compile all result screenshots from a run into a looping GIF.
 * Returns the file path of the generated GIF.
 */
export async function generateRunGif(
  screenshotDir: string,
  runId: string,
): Promise<string | null> {
  // Collect all screenshots in order: input, per-action, then result for each turn
  const files: string[] = [];
  for (let i = 1; ; i++) {
    // Check if this turn exists at all
    const resultPath = path.join(screenshotDir, `turn-${i}-result.png`);
    const hasActions = fs.existsSync(path.join(screenshotDir, `turn-${i}-action-0.png`));
    if (!resultPath || !fs.existsSync(resultPath)) {
      // No result screenshot — check if there are action screenshots at least
      if (!hasActions) break;
    }

    // Add input screenshot (exists for turn > 1)
    const inputPath = path.join(screenshotDir, `turn-${i}-input.png`);
    if (fs.existsSync(inputPath)) {
      files.push(inputPath);
    }

    // Add per-action screenshots
    for (let j = 0; ; j++) {
      const actionPath = path.join(screenshotDir, `turn-${i}-action-${j}.png`);
      if (fs.existsSync(actionPath)) {
        files.push(actionPath);
      } else {
        break;
      }
    }

    // Add final result screenshot
    if (fs.existsSync(resultPath)) {
      files.push(resultPath);
    }
  }

  if (files.length === 0) return null;

  // Read first image to get dimensions
  const firstPng = PNG.sync.read(fs.readFileSync(files[0]));
  const { width, height } = firstPng;

  const encoder = new GIFEncoder(width, height);
  const gifPath = path.join(screenshotDir, "run.gif");
  const writeStream = fs.createWriteStream(gifPath);

  encoder.createReadStream().pipe(writeStream);
  encoder.start();
  encoder.setRepeat(-1); // -1 = no loop, play once
  encoder.setDelay(FRAME_DELAY_MS);
  encoder.setQuality(10);

  for (const file of files) {
    const png = PNG.sync.read(fs.readFileSync(file));
    encoder.addFrame(png.data as unknown as Buffer);
  }

  encoder.finish();

  // Wait for the write stream to finish
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  return gifPath;
}
