import { PNG } from "pngjs";

const CHANNEL_TOLERANCE = 10;
const STUCK_THRESHOLD = 0.90;

export function compareScreenshots(buf1: Buffer, buf2: Buffer): number {
  const img1 = PNG.sync.read(buf1);
  const img2 = PNG.sync.read(buf2);

  // If dimensions differ, they're not similar
  if (img1.width !== img2.width || img1.height !== img2.height) {
    return 0;
  }

  const totalPixels = img1.width * img1.height;
  let matching = 0;

  for (let i = 0; i < img1.data.length; i += 4) {
    const rDiff = Math.abs(img1.data[i] - img2.data[i]);
    const gDiff = Math.abs(img1.data[i + 1] - img2.data[i + 1]);
    const bDiff = Math.abs(img1.data[i + 2] - img2.data[i + 2]);

    if (rDiff <= CHANNEL_TOLERANCE && gDiff <= CHANNEL_TOLERANCE && bDiff <= CHANNEL_TOLERANCE) {
      matching++;
    }
  }

  return matching / totalPixels;
}

const STUCK_CONSECUTIVE = 5;

export function isStuck(recentBuffers: Buffer[]): boolean {
  if (recentBuffers.length < STUCK_CONSECUTIVE) return false;

  const len = recentBuffers.length;
  // Check that the last STUCK_CONSECUTIVE-1 consecutive pairs are all similar
  for (let i = 1; i < STUCK_CONSECUTIVE; i++) {
    const sim = compareScreenshots(recentBuffers[len - i - 1], recentBuffers[len - i]);
    if (sim <= STUCK_THRESHOLD) return false;
  }

  return true;
}
