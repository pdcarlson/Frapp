# Product Requirements Document: Frapp (Fraternity App)

## 1. Executive Summary

Frapp is a multi-tenant SaaS platform designed to manage the operations of fraternity chapters. It replaces disjointed tools (Discord, OmegaFi, Life360) with a single, unified mobile and web experience.
**Core Philosophy:** "The Operating System for Greek Life."

## 2. Core Domains

### A. Identity & Access (IAM)

- **Auth Provider:** Clerk (Handles Login, MFA, Password Reset).
- **Multi-Tenancy:**
  - Users belong to a **Chapter** (Tenant).
  - **Strict Mode:** A user can only access data for their specific `chapter_id`.
- **RBAC (Role-Based Access Control):**
  - **Roles:** `President`, `Treasurer`, `New Member`, `Alumni`.
  - **Permissions:** Granular flags (e.g., `events:create`, `ledger:view_all`).
  - **Sync:** Clerk Webhooks -> Application DB (Postgres).

### B. The "Backwork" Library (Academic Repository)

- **Storage:** AWS S3 (Private Buckets).
- **Upload Flow (Presigned URLs):**
  1.  Client requests upload slot for `CS101_Final_2024.pdf`.
  2.  API validates permissions & generates S3 Presigned URL.
  3.  Client uploads directly to S3 (bypassing API bandwidth).
  4.  Client notifies API "Upload Complete".
  5.  API stores metadata in Postgres.
- **Metadata Schema:**
  - `course_code` (e.g., "CS101")
  - `professor` (e.g., "Smith")
  - `term` (e.g., "Fall 2024")
  - `tags` (Array: ["Exam", "Study Guide", "Easy A"])

### C. Financials (Billing & Ledger)

- **SaaS Billing (The Revenue):**
  - **Customer:** The Chapter.
  - **Provider:** Stripe.
  - **Model:** Fixed Monthly Subscription (e.g., $150/mo flat).
  - **Enforcement:** "Invite Member" endpoint throws `402 Payment Required` if subscription is inactive.
- **Internal Ledger (The Points):**
  - **Double-Entry:** Every point change is a transaction.
  - `Debit: Brother A` -> `Credit: House Points`.

### D. Communications (Chat & Notifications)

- **Chat Engine:** Custom Real-time Messaging (Socket.io).
- **Structure:**
  - **Channels:** Role-gated (e.g., `#exec-board` only visible to Officers).
  - **Read Receipts:** "Last Read Timestamp" per channel per user.
- **Notifications:**
  - **Provider:** Expo Push Service.
  - **Triggers:** Chat Mentions (`@user`), Task Assignments, Geofence Entry (Study Hours).

### E. Location (Study Hours)

- **Mode:** Active Tracking (Opt-in).
- **Logic:**
  - Admin draws Polygon (Library).
  - User taps "Start Studying."
  - App sends GPS heartbeat every 5 mins.
  - Server validates `Point(User) inside Polygon(Library)`.
  - Points awarded automatically.

## 3. Onboarding Flow

1.  **Chapter Creation:** Admin pays via Stripe -> Chapter Created.
2.  **Invite System:** Admin generates "Invite Token" (valid for 24h).
3.  **User Join:** User signs up via Clerk -> Enters Token -> API links User to Chapter.
