# User Controller Testing Update

Added unit tests for the `UserController` in `apps/api/src/interface/controllers/user.controller.spec.ts`.
This ensures test coverage for the endpoints `getMe`, `updateMe`, and `requestAvatarUploadUrl`.

- Mocks `UserService`
- Validates that guards and interceptors are appropriately applied to the controller and its methods via reflection (`Reflect.getMetadata`).
