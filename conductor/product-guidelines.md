# Frapp Product Guidelines

## 1. Visual Identity: "Modern Ivy"

Frapp follows a "Modern Ivy" aesthetic—balancing the prestige of traditional Greek life with the high-utility, clean feel of modern SaaS platforms.

### 🎨 Color Palette
- **Primary (Navy):** `#0F172A` (Professional, trustworthy)
- **Secondary (Royal Blue):** `#2563EB` (Action-oriented)
- **Success (Emerald):** `#10B981` (Growth, positive point transactions)
- **Background (Slate):** `#F8FAFC` (Clean, focused)

### Typography
- **Primary Font:** `Geist` or `Inter` (Clean sans-serif for high readability)
- **Scale:** High density for dashboards, generous spacing for member mobile experience.

---

## 2. Technical Standards

### Architecture
- **Pattern:** Layered Architecture (`Interface` -> `Application` -> `Infrastructure` -> `Domain`).
- **Persistence:** Repository Pattern via Drizzle ORM.
- **Security:** Clerk for Identity, SVIX for Webhooks.

### Quality Gates
- **Testing:** TDD mandatory. Minimum 80% line coverage.
- **Validation:** Global `ValidationPipe` for all entry points.
- **Documentation:** living Swagger UI at `/docs`.
