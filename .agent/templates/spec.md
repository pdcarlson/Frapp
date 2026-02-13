# Feature Specification: [Feature Name]

## 1. Context & Goal

_Describe what we are building and why. Link to any relevant PRD sections._

## 2. User Story

As a **[Role]**, I want to **[Action]** so that **[Benefit]**.

## 3. Technical Requirements

- [ ] **Endpoint:** `VERB /api/v1/resource`
- [ ] **Input:** Zod Schema (describe fields)
- [ ] **Output:** Success/Error Types
- [ ] **Database Changes:** (List tables/columns affected)
- [ ] **Events:** (Events emitted, e.g., `task.created`)

## 4. Security & Permissions

- **Required Role:** (e.g., `treasurer`)
- **Tenant Check:** Must enforce `where chapter_id = X`

## 5. Test Plan (TDD)

- [ ] Case 1: Happy Path
- [ ] Case 2: Validation Error
- [ ] Case 3: Unauthorized Access
