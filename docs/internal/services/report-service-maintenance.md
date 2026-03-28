# Report service — maintenance notes

## 2026-03-28

- `ReportService.getRosterReport` propagates Supabase errors from the `point_transactions` fetch using `throwIfError`, consistent with the other reads in that method, so a failed query does not silently report zero point balances.
