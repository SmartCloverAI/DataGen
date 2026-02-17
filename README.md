# DataGen

**DataGen** is a commercial-grade synthetic data generation platform that helps teams create high-quality structured datasets quickly, safely, and repeatedly.

It combines a Next.js full-stack app with Ratio1 CStore persistence and strict authentication to support auditable AI-data workflows for product, research, and regulated environments.

## Why DataGen

- Generate synthetic datasets with predictable quality using one model call per record.
- Keep full traceability of jobs, progress, outputs, and metrics in persistent storage.
- Enforce authentication and session control across all API and UI actions.
- Export usable results fast (JSON/CSV) for analytics, testing, and model development.
- Fit modern AI product teams that need delivery speed without compromising governance.

## Ownership and Commercial Context

**Owner:** `SmartClover SRL` (Romania)

DataGen is part of SmartClover SRL's product strategy and aligns with the company's public objectives:

- Human-in-the-loop AI systems.
- Data sovereignty and controlled deployments ("your AI, your Data").
- Practical healthcare AI productization through SaaS/PaaS delivery models.

As published on SmartClover channels (accessed February 17, 2026), SmartClover operates a portfolio that includes:

- **CerviGuard** (MDR Class I cervical cancer screening companion app).
- **Evidence-Linked Healthcare Research Platform**.
- **Digital Resilience Platform for Healthcare**.
- **Creative Education Experience Platform**.

DataGen serves as an enabling layer for synthetic data operations across these product directions and adjacent enterprise use cases.

## Quickstart

1. Install dependencies (Node 18+):
```bash
npm install
```
2. Set environment variables.
3. Run:
```bash
npm run dev
```

## Environment Variables

- `EE_CHAINSTORE_API_HOST` / `EE_CHAINSTORE_API_PORT` (required): Ratio1 CStore endpoint (fallback: `EE_CHAINSTORE_API_URL`).
- `EE_R1FS_API_HOST` / `EE_R1FS_API_PORT` (optional): Ratio1 file store (fallback: `EE_R1FS_API_URL`, not used yet).
- `R1EN_CSTORE_AUTH_HKEY`: Hash key for auth (fallback: `EE_CSTORE_AUTH_HKEY`).
- `R1EN_CSTORE_AUTH_SECRET`: Pepper for password hashing (fallback: `EE_CSTORE_AUTH_SECRET`).
- `R1EN_CSTORE_AUTH_BOOTSTRAP_ADMIN_PWD`: Bootstrap admin password (fallback: `EE_CSTORE_AUTH_BOOTSTRAP_ADMIN_PW`).
- `DATAGEN_SESSION_SECRET`: Secret used to sign session cookies/JWTs.
- `DATAGEN_APP_HOST` / `DATAGEN_APP_PORT`: Public app host/port (fallback: `DATAGEN_APP_URL`).
- `DATAGEN_INFERENCE_HOST` / `DATAGEN_INFERENCE_PORT`: Inference gateway host/port (fallback: `DATAGEN_INFERENCE_BASE_URL`).
- `LOG_INFERENCE_REQUESTS`: When `true`, logs outgoing inference requests (auth header redacted).
- `RETRY_INFERENCE_ON_FAILURE`: When `true`, retries one extra inference call on failure/parse errors.
- `NEXT_PUBLIC_SHOW_FAILURES`: When `true`, shows failure counts in UI task cards.
- `DATAGEN_MAX_RECORDS_PER_JOB`: Max records per job (default `200`).
- `DATAGEN_MOCK_CSTORE`: When `true`, uses in-memory mock CStore/auth (`admin/admin`, `test_user/testtest`).
- `DATAGEN_MOCK_INFERENCE_API`: When `true`, uses in-memory mock inference that returns random JSON records.
- `DATAGEN_ACTIVE_POLL_SECONDS`: Poll interval while tasks are active (default `2`).
- `DATAGEN_IDLE_POLL_SECONDS`: Poll interval when idle (default `10`).

## Current API Surface

- `POST /api/auth/login`: Authenticate via `cstore-auth-ts`; sets HttpOnly session cookie.
- `POST /api/auth/logout`: Clears the session.
- `GET /api/auth/me`: Returns current session (`401` when missing/invalid).
- `GET /api/metrics`: Auth-protected metrics from persisted CStore counters.

## Project Layout

```text
app/
  (auth)/login/page.tsx
  (app)/page.tsx
  api/
    auth/login|logout|me
    metrics/route.ts
lib/
  auth/
  datagen/
  ratio1/
```

## Citation (BibTeX)

```bibtex
@software{smartclover_datagen_2026,
  author       = {{SmartClover SRL}},
  title        = {DataGen: Synthetic Dataset Generation Platform},
  year         = {2026},
  version      = {0.5.0},
  url          = {https://github.com/SmartCloverAI/DataGen},
  organization = {SmartClover SRL},
  note         = {Accessed 2026-02-17}
}
```

## References

- SmartClover official site: https://smartclover.ro/
- SmartClover About: https://smartclover.ro/about
- SmartClover Products & More: https://smartclover.ro/services
- CerviGuard public workspace: https://cerviguard.link
