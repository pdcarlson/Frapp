## Chat Service Tests

### createCategory
- **Scenario**: When provided with a `display_order`.
  - **Expected**: Should pass the provided `display_order` to the underlying repository.
- **Scenario**: When `display_order` is absent.
  - **Expected**: Should pass a default `display_order` of `0` to the underlying repository.
