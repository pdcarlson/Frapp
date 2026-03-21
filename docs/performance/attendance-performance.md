# Attendance Marking Optimization

**Date:** 2026-03-21

## Overview
Replaced `Promise.allSettled(array.map(...))` in `markAutoAbsent` with `createMany` bulk insert.

## Details
Previously, iterating over multiple required members and using `Promise.allSettled` around individual `create` operations caused unnecessary network overhead by executing N separate insert queries for large chapters.

By using `this.attendanceRepo.createMany()` (which utilizes Supabase's native array `.insert()`), we:
1. Drastically reduce concurrent database connections and latency by executing a single query.
2. Avoid rate-limiting issues for large batch operations.
3. Optimize database inserts from O(N) queries to O(1) query.

This replaces the previous `Promise.allSettled` implementation to be significantly more efficient for large-scale operations.
