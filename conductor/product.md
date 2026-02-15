# Product Definition: Frapp (Fraternity App)

## 1. Overview
Frapp is a multi-tenant SaaS platform designed to manage the operations of fraternity chapters. It provides a unified experience for identity, academics, financials, communications, and location-based study tracking.

## 2. Core Domains

### A. Identity & Access (IAM)
- **Multi-Tenancy:** Users are linked to chapters. Access is strictly scoped by `chapter_id`.
- **RBAC:** Roles like President, Treasurer, Member, and Alumni control granular permissions.

### B. The "Backwork" Library (Academic Repository)
- **Storage:** AWS S3 for academic materials.
- **Metadata:** Elastic tagging system for courses and professors.

### C. Communications (Chat & Notifications)
- **Real-time Chat:** Custom Socket.io implementation with role-gated channels (e.g., #exec-board).
- **Notifications:** Push notifications via Expo for mentions and assignments.

### D. Financials & Points (Ledger)
- **SaaS Billing:** Chapter-level subscriptions managed via Stripe.
- **Internal Ledger:** A double-entry point system. "House Points" awarded for attendance, academics, and service.
- **Attendance:** QR-code or location-based check-ins for meetings and events.

### E. Location & Study Hours
- **Active Tracking:** Opt-in geofenced study sessions.
- **Geofencing:** Server-side validation of user location within predefined polygons (e.g., Library).
- **Automation:** Automatic point accrual based on validated study time.
