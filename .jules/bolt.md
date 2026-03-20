## 2026-03-19 - Use Promise.allSettled over iterative await for database writes
**Learning:** In the backend `apps/api`, looping through multiple entities to sequentially wait for database creates or updates (e.g., `for...of` loops with `await this.repo.create()`) causes significant N+1 queries issues and slows down processing.
**Action:** When updating multiple database entries, replace `await` in loops with `Promise.allSettled(array.map(...))`. This runs the operations concurrently and prevents a single failure from interrupting the entire sequence.

## 2024-05-18 - Optimize Event Recurring Instance Generation
**Learning:** Promise.all for database operations causes N+1 connection overhead and blocks thread. Bulk inserts via arrays (e.g. `createMany`) drastically improve execution speed.
**Action:** Always prefer bulk insert methods like `createMany` over `Promise.all(mapped array of creates)` for entity generation.
