# Mobile Testing

The `apps/mobile` workspace has been configured with Vitest for testing.

We use `vitest.setup.ts` to mock out native Expo modules (`expo-file-system/legacy`, `expo-sharing`) and `react-native` platform globals.

To run the test suite:
\`\`\`bash
npm run test -w apps/mobile
\`\`\`
