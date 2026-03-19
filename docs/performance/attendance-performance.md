# Attendance Marking Optimization

**Date:** 2026-03-19

## Overview
Replaced sequential `await` in `markAutoAbsent` with `Promise.allSettled(array.map(...))`.

## Details
Previously, iterating over multiple required members and awaiting database creates (`await this.attendanceRepo.create()`) sequentially caused significant N+1 queries issues and slowed down processing when marking members absent in large chapters.

By using `Promise.allSettled()`, we:
1. Run all operations concurrently, reducing overall execution time and avoiding the N+1 queries bottleneck.
2. Prevent a single database failure from interrupting the entire loop.

This aligns with our guidelines for handling N+1 queries and concurrent execution.
