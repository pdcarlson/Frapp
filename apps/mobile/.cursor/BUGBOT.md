## Mobile review focus

- Watch for iOS and Android platform-specific behavior differences before suggesting shared fixes.
- Treat `AsyncStorage`, notification permissions, and Expo module usage as sensitive integration points.
- Flag missing cleanup in effects, subscription leaks, and background lifecycle issues.
- Prefer fixes that preserve offline/degraded UX states instead of assuming constant network access.
