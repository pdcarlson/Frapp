module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@repo/.*)"
  ],
  setupFilesAfterEnv: ["<rootDir>/jest-setup.js"],
  setupFiles: ["<rootDir>/jest-setup-pre.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@repo/theme/tokens$": "<rootDir>/../../packages/theme/src/tokens.ts",
    "^expo/(.*)$": "<rootDir>/__mocks__/expo-mock.js"
  },
  testEnvironment: "node"
};
