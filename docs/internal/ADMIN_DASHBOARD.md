# Frapp Admin Dashboard

## Overview
The Frapp Admin Dashboard (`apps/web`) is the central operating system for Greek Life chapter operations. It provides an interface for chapter admins to manage events, members, points, billing, and other core functions.

## Home Page (`/`)
The main landing page for the admin dashboard provides an overview card indicating that the foundation is active.

### Components
- **Card, CardHeader, CardTitle, CardDescription:** These components structure the introductory messaging for the dashboard.
- **Buttons (In Progress):** Currently, authentication workflows and internal routing are being rolled out. As such, the "Sign in" and "Dashboard routes" buttons are currently disabled with accessibility aria-labels attached. 
- **Search Inputs:** The dashboard features multiple search inputs (e.g., events, leaderboard, transactions) that use icons instead of visible labels. For accessibility, these inputs must always include an `aria-label`.

## Roadmap
As new administrative workflows are completed, the initial placeholder page will be expanded to support full navigation.
