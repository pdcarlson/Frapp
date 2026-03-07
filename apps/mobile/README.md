# Frapp Mobile App (`apps/mobile`)

Expo app for member workflows on iOS and Android.

## Local development

From repo root:

```bash
npm run start -w apps/mobile
```

Then scan the QR code in Expo Go (same local network).
This app cannot be tested in a headless cloud VM — it requires Expo Go on a physical device or a local emulator.

## Environment

Create `.env.local` with the required variables. See [`docs/internal/ENV_REFERENCE.md`](../../docs/internal/ENV_REFERENCE.md) for the complete list and values per environment.

## Common commands

```bash
# Start Expo
npm run start -w apps/mobile

# Platform shortcuts
npm run ios -w apps/mobile
npm run android -w apps/mobile
npm run web -w apps/mobile

# Lint
npm run lint -w apps/mobile

# Type check
npm run check-types -w apps/mobile
```

## Build/submit configuration

- EAS profiles: `apps/mobile/eas.json`
- Expo app metadata: `apps/mobile/app.json`
