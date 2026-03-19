Updated chapter service to use createMany to avoid N+1 query.

## Optimization (March 2026)
- **N+1 Issue Resolved**: Previously, creating a new chapter incurred sequential role creation. This has been resolved by utilizing `this.roleRepo.createMany()` to bulk insert all default roles in a single database round-trip. This drops database queries related to roles during chapter creation from `N` to `1`.
- **Channel Seeding Optimization**: Chat channel seeding during chapter creation was also updated to insert the entire `DEFAULT_CHANNELS` array in one call instead of sequentially inserting them in a `for` loop.
