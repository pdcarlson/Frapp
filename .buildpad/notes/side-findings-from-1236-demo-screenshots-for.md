**Side findings from #1236 (demo screenshots for marketing), unrelated to Discord work but worth tracking:**

- **#1239 (merged)** — mobile sign-in screen was still branded "Frapp," fixed to Signet name/tagline/mark. Flagged, not fixed: spec/product/README.md headline and the API's Swagger description still say the old tagline. Changing the product spec's headline is a positioning call, not mechanical — needs your wording decision.
- **#1237 (open)** — mobile can't hold a session on Expo web at all, so no agent session can verify a signed-in mobile screen. Testing/tooling limitation, not a user-facing bug.
- **#1238 (open)** — you flagged real web dashboard UI defects after reviewing the generated screenshots. Worth checking what these are before beta.
- **#1066 (open, pre-existing)** — the design reference file is double-encoded, corrupting special characters. Being worked around, not fixed at the source yet.