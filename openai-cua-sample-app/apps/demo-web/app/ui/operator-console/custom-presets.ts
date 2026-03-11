import type { CustomPreset } from "./types";

export const customPresets: CustomPreset[] = [
  {
    id: "__preset_hn_top",
    title: "HN Top Stories",
    prompt:
      "Go to https://news.ycombinator.com and tell me the top 5 stories on the front page with their titles, points, and number of comments.",
    mode: "native",
  },
  {
    id: "__preset_google_search",
    title: "Google Search Test",
    prompt:
      "Go to https://www.google.com, search for 'OpenAI CUA computer use agent', and tell me the titles of the first 5 search results.",
    mode: "native",
  },
  {
    id: "__preset_wikipedia",
    title: "Wikipedia Lookup",
    prompt:
      "Go to https://en.wikipedia.org and search for 'Large language model'. Read the first paragraph of the article and summarize it in 2-3 sentences.",
    mode: "native",
  },
  {
    id: "__preset_slawk_dm",
    title: "Slawk DM Flow",
    prompt:
      "Go to https://slawk.ncvgl.com. Log in with email demo@slawk.dev and password tryme123. Once logged in, find Eve in the direct messages. Send her the message 'Hello'. Then add a smiley reaction to that message. Finally, delete the message you sent.",
    mode: "native",
  },
];
