# Specification: Clerk Webhooks & User Synchronization

## Overview
This track focuses on creating a robust, decoupled system to synchronize user data from Clerk to our internal PostgreSQL database via webhooks. We will follow a layered architecture to ensure modularity and ease of testing.

## Goals
- Securely receive webhooks from Clerk using SVIX verification.
- Synchronize `user.created`, `user.updated`, and `user.deleted` events.
- Maintain a layered architecture: `Interface` -> `Application` -> `Infrastructure` -> `Domain`.
- Ensure high test coverage with unit and integration tests.
- Prepare the system for future scalability (Rate limiting, horizontal scaling).

## Technical Requirements
- **Validation:** Use `class-validator` and `class-transformer` for DTO validation.
- **Security:** Use `svix` for webhook signature verification.
- **Documentation:** Use `@nestjs/swagger` for API documentation.
- **Architecture:** 
  - **Interface Layer:** Controllers, DTOs, Webhook Guards.
  - **Application Layer:** Services (Use cases) for user synchronization.
  - **Infrastructure Layer:** Drizzle Repository implementations, Database schema.
  - **Domain Layer:** Business entities and Repository interfaces.

## Schema Changes
- Define `chapters` table.
- Define `roles` and `permissions` tables.
- Update `users` table to support Clerk metadata if necessary.
