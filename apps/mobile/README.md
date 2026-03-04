# Frapp Mobile App (`apps/mobile`)

Expo app for member workflows on iOS and Android.

## Local development

From repo root:

```bash
npm run start -w apps/mobile
```

Then scan the QR code in Expo Go (same local network).

## Environment

Copy `.env.example` to `.env.local` and configure:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_URL`

## Common commands

```bash
# Start Expo
npm run start -w apps/mobile

# Platform shortcuts
npm run ios -w apps/mobile
npm run android -w apps/mobile
npm run web -w apps/mobile

# Type check
npm run check-types -w apps/mobile
```

## Build/submit configuration

- EAS profiles: `apps/mobile/eas.json`
- Expo app metadata: `apps/mobile/app.json`
