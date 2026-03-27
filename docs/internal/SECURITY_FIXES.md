## 2024-03-27 - CORS Configuration Update
Updated the CORS configuration in `apps/api/src/main.ts` to use a strict regex for `origin` matching.
The regex `/^https:\/\/([a-zA-Z0-9-]+\.)*frapp\.live$/` enforces the HTTPS protocol and strictly limits origins to the `frapp.live` root domain and its subdomains, mitigating risks from similarly named malicious domains.
