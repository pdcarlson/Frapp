# Frapp Admin Dashboard

## Overview
The Frapp Admin Dashboard (`apps/web`) is the central operating system for Greek Life chapter operations. It provides an interface for chapter admins to manage events, members, points, billing, and other core functions.

## Home Page (`/`)
The main landing page for the admin dashboard provides an overview card indicating that the foundation is active.

### Components
- **Card, CardHeader, CardTitle, CardDescription:** These components structure the introductory messaging for the dashboard.
- **Buttons (In Progress):** Currently, authentication workflows and internal routing are being rolled out. As such, the "Sign in" and "Dashboard routes" buttons are currently disabled with accessibility aria-labels attached. 

## Roadmap
As new administrative workflows are completed, the initial placeholder page will be expanded to support full navigation.

### Offline Support and Testing
The admin dashboard includes an `OfflineBanner` component to gracefully handle network degradation and offline scenarios. The component logic is fully covered by unit tests configured using `vitest` and `@testing-library/react`.

- Added aria-labels to the points and events dashboard search inputs.
