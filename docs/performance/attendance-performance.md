# Attendance Marking Optimization

**Date:** 2026-03-23

## Overview
Replaced `Promise.allSettled(array.map(...))` with a single bulk `createMany` operation using Supabase `.insert()`.

## Details
Previously, iterating over multiple required members and using `Promise.allSettled()` with individual database creates (`await this.attendanceRepo.create()`) caused an N+1 queries issue, slowing down processing when marking members absent in large chapters.

By using `createMany` with a single array `.insert()` in Supabase, we:
1. Run all operations in a single database round trip, effectively solving the N+1 queries bottleneck.
2. Ensure we use the best tool available for bulk insertions.

This aligns with our guidelines for handling N+1 queries and improving backend performance.
