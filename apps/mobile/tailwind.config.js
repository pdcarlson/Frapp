/** @type {import('tailwindcss').Config} */
const sharedConfig = require("@repo/theme/tailwind").default;

module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset"), sharedConfig],
  theme: {
    extend: {},
  },
  plugins: [],
};
