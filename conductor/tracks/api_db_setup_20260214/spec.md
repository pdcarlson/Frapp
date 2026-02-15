# Specification: Initial API and Database Setup

## 1. Overview

This document outlines the technical specifications for the initial setup of the Frapp API and database. This includes setting up the database using Docker, configuring the API, implementing authentication, and establishing a testing framework.

## 2. Database

- **Database:** PostgreSQL 16
- **ORM:** Drizzle ORM
- **Setup:** The database will be run in a Docker container for local development. A `docker-compose.yml` file will be created to define the database service.
- **Schema:**
  - **Users:** `id`, `clerk_id`, `email`
  - **Members:** `user_id`, `chapter_id`, `role_ids[]`
  - All other tables must include a `chapter_id` foreign key to enforce multi-tenancy.

## 3. API

- **Framework:** NestJS (Node.js)
- **Language:** TypeScript (Strict)
- **Authentication:**
  - **Provider:** Clerk
  - **Implementation:** A `ClerkAuthGuard` will be created to validate JWTs on incoming requests.
- **Multi-Tenancy:**
  - A `ChapterGuard` will be implemented to enforce that the `x-chapter-id` header matches the user's permissions.

## 4. Testing

- **Framework:** Jest
- **Workflow:** Test-Driven Development (TDD) will be followed.
- **Initial Tests:**
  - Unit tests will be created for the `ClerkAuthGuard` and `ChapterGuard`.
  - Integration tests will be created to verify the database connection and basic API functionality.
