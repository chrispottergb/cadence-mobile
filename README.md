# Cadence Mobile

Development codename **Cadence**. A new martial-arts training and AI-music platform. This is an independent product with its own history; it shares no code, identifiers, infrastructure, or data with any prior application.

## Stack

- Expo SDK 56, React Native 0.85, TypeScript strict, expo-router
- Supabase Auth (email OTP, Sign in with Apple) via `@supabase/supabase-js`
- Music generation is never called from the app; it goes through the Cadence Music Service

## Layout

```
app/                expo-router routes (auth, experience shells)
src/auth/           Supabase client, session store
src/experience/     experience resolver + switcher (instructor / student / parent)
src/data/           typed data access (gyms, memberships, guardian links)
src/ui/             design primitives (tokens, Screen, Text, Button)
supabase/           migrations + RLS tests for the Cadence Supabase project
```

## Scripts

```
npm run lint
npm run typecheck
npm test
npm run check      # all three
npm start
```

## Environment

Copy `.env.example` to `.env`. Only `EXPO_PUBLIC_*` variables exist on the client. Secrets live only in the Music Service and Supabase.
