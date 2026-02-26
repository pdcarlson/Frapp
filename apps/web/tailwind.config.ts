import type { Config } from "tailwindcss";
import sharedConfig from "@repo/theme/tailwind";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  presets: [sharedConfig],
  darkMode: "class",
};

export default config;
