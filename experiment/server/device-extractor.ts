import OpenAI from "openai";

export type DevicePreset =
  | "desktop"
  | "iphone_14"
  | "iphone_14_pro_max"
  | "ipad_pro_11"
  | "pixel_7"
  | "galaxy_s23_ultra"
  | "galaxy_tab_s8";

export type DeviceConfig = {
  preset: DevicePreset;
  label: string;
  viewport: { width: number; height: number };
  userAgent: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
};

const DEVICE_CONFIGS: Record<DevicePreset, DeviceConfig> = {
  desktop: {
    preset: "desktop",
    label: "Desktop (1440x900)",
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  iphone_14: {
    preset: "iphone_14",
    label: "iPhone 14 (390x844)",
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  iphone_14_pro_max: {
    preset: "iphone_14_pro_max",
    label: "iPhone 14 Pro Max (430x932)",
    viewport: { width: 430, height: 932 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  ipad_pro_11: {
    preset: "ipad_pro_11",
    label: "iPad Pro 11 (834x1194)",
    viewport: { width: 834, height: 1194 },
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15A5304j Safari/604.1",
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  pixel_7: {
    preset: "pixel_7",
    label: "Pixel 7 (412x915)",
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  galaxy_s23_ultra: {
    preset: "galaxy_s23_ultra",
    label: "Galaxy S23 Ultra (412x915)",
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  galaxy_tab_s8: {
    preset: "galaxy_tab_s8",
    label: "Galaxy Tab S8 (800x1280)",
    viewport: { width: 800, height: 1280 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

const VALID_PRESETS = Object.keys(DEVICE_CONFIGS) as DevicePreset[];

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * Uses gpt-4o-mini to extract a target device from the user's prompt.
 * Returns a DeviceConfig. Defaults to "desktop" if no device is mentioned.
 */
export async function extractDevice(prompt: string): Promise<DeviceConfig> {
  const openai = getClient();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: `Extract the target TEST DEVICE from this QA test prompt. The user may specify which device to emulate for testing. Return ONLY one of these values, nothing else:
${VALID_PRESETS.join(", ")}

Guidelines:
- Look for phrases like "test on iPhone", "on Pixel 7", "on Android", "using mobile", "on iPad" — these indicate the target device.
- IMPORTANT: Ignore device names that appear in the TEST CONTENT itself (e.g. "search for Android phone", "look up iPhone specs", "open the Samsung page"). These are things to search/interact with, NOT the device to test on.
- Only extract a non-desktop device if the prompt clearly indicates the TEST should RUN on that device.
- "test on iphone", "on ios" → iphone_14
- "test on iphone pro max", "large iphone" → iphone_14_pro_max
- "test on ipad", "on ios tablet" → ipad_pro_11
- "test on android", "on pixel", "on mobile" → pixel_7
- "test on samsung", "on galaxy" → galaxy_s23_ultra
- "test on android tablet" → galaxy_tab_s8
- No device specification, or ambiguous → desktop

Return only the preset name, no explanation.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "desktop";
    const preset = VALID_PRESETS.includes(raw as DevicePreset)
      ? (raw as DevicePreset)
      : "desktop";

    return DEVICE_CONFIGS[preset];
  } catch (err) {
    console.error("Device extraction failed, defaulting to desktop:", (err as Error).message);
    return DEVICE_CONFIGS.desktop;
  }
}

export function getDeviceConfig(preset: DevicePreset): DeviceConfig {
  return DEVICE_CONFIGS[preset];
}
