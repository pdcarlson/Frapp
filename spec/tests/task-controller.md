# Task Controller Tests

Tests for `TaskController` verify that the controller correctly handles task operations via HTTP endpoints, enforces RBAC checks, and interacts with `TaskService` correctly.

## Coverage

*   **`list` Endpoint:** Verifies that tasks are listed based on whether the user has the `TASKS_MANAGE` permission (returning all chapter tasks for admins, and assigned tasks for standard users).
*   **`getOne` Endpoint:** Verifies that task details can be retrieved by an admin or the assignee, and throws a `ForbiddenException` for unauthorized access.
*   **`create` Endpoint:** Verifies task creation logic with both full and optional fields gracefully handled.
*   **`updateStatus` Endpoint:** Verifies updating a task's status checks the user's permissions and delegates to the service layer.
*   **`confirmCompletion` Endpoint:** Verifies confirmation logic and potential point awarding delegation.
*   **`rejectCompletion` Endpoint:** Verifies that task completion rejection can handle optional comments.
*   **`delete` Endpoint:** Verifies task deletion.

## Technical Details

*   Framework: Jest
*   Mocking: Both `TaskService` and `RbacService` are fully mocked.
*   Guards Override: `SupabaseAuthGuard`, `ChapterGuard`, and `PermissionsGuard` are stubbed to return `true` to isolate the controller's logic during tests.
