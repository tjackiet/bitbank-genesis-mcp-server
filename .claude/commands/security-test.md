---
description: "Run chaos engineering and security tests (local only, excluded from public CI)"
---

# Security & Chaos Tests

Run all security-related tests that are excluded from the public repository.

```bash
npx vitest run tests/chaos/ tests/private/security.test.ts --reporter=verbose --config vitest.security.config.ts
```

Report the results with a summary of passed/failed tests.
If any tests fail, investigate the root cause and suggest fixes.
