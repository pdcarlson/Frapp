# Event Generation Performance Optimization

## Problem
When users create an event with a recurrence rule (e.g., Weekly, Bi-weekly, Monthly), the system generates numerous child instances of the event.
Previously, this logic executed an `Array.from().map()` loop returning promises for individual `this.eventRepo.create(...)` insertions, which were then resolved via `await Promise.all()`.

While this effectively ran the database insertions in parallel, it resulted in N separate database connections and queries. Under high load or significant recurrence counts, this could lead to connection pool exhaustion and substantial round-trip network delays.

## Optimization
We have introduced a `createMany(data: Partial<Event>[]): Promise<void>` bulk insertion method to the `IEventRepository`.

The Supabase implementation of this repository accepts the entire array and executes a single `.insert(data)` operation.

The `EventService.generateRecurringInstances` method now builds the array of instance objects in memory and passes the entire payload to `createMany`.

### Benchmark Results
Executing a mock benchmark for 12 instances (the standard for `WEEKLY` recurrence) demonstrates the performance savings:
* **Sequential Loop:** ~600ms
* **Parallel (`Promise.all`):** ~50ms
* **Bulk (`createMany`):** ~60ms

While the raw execution speed of bulk insertion is comparable to parallel execution, the critical gain is in **database connection overhead and pool management**. By reducing N queries to 1 query, we protect the database connection limit and scale significantly better during concurrent event creation.

## Testing Strategy
The unit test suite has been updated to mock `createMany` and assert against the structure of the passed array, ensuring that date offset calculations are correctly batched before insertion.
