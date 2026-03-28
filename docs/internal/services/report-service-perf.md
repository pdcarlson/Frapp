# Report Service Performance

## getRosterReport
The `getRosterReport` method fetches a list of members, and then needs to retrieve details about those users and their point transactions.

To minimize latency for large chapters, the queries for `users` and `point_transactions` are parallelized using `Promise.all()`. They depend on the result of the `members` query, but are independent of each other. This reduces the number of sequential network roundtrips required to build the roster report.
