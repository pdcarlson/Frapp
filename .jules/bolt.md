## 2024-03-19 - Batch Insert Optimization for Attendance Auto-Absent
**Learning:** The Supabase repository implementation pattern (via Hexagonal architecture) allows easily extending domain repositories with `createMany` methods to bypass N+1 insert query bottlenecks. The native `.insert(array)` in Supabase handles this cleanly.
**Action:** When implementing bulk updates or absent marking loops, always prefer injecting `createMany` instead of sequential `await this.repo.create()` to avoid N+1 issues in this specific codebase architecture.
