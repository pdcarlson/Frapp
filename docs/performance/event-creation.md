# Optimizing Recurring Event Creation

## Background

When creating recurring events in the application, the `generateRecurringInstances` method would loop sequentially through the generated dates and `await` the event creation individually.

For events with long recurrences (e.g., weekly events for a 12-week period), this resulted in the classic N+1 query problem, slowing down API response times due to sequential database connections and network overhead.

## Solution

The `generateRecurringInstances` method was refactored to optimize this operation by executing database calls concurrently.

Instead of an iterative `await`, we now collect all `eventRepo.create` promises into an array and resolve them simultaneously using `Promise.all()`.

**Why Promise.all and not Promise.allSettled?**
While `Promise.allSettled()` executes concurrently, it silently swallows failures. If any query violates database constraints or fails due to network issues, it would not trigger an exception. By using `Promise.all()`, we maintain safe error propagation while keeping the performance benefits of concurrent database requests.
