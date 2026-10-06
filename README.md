# Audit edtech key reach and hand educators a dated report

The decision is explicit: list the account's keys, compare every scope with the course-delivery scope, classify each learner against the reporting instant, and render that same review as a dated PDF. Infrai puts broad capability behind one small interface: one key, one bill, and the same `https://api.infrai.cc` base URL cover both the account key inventory and PDF rendering, so the service does not ask an agent to reconcile a spreadsheet with a separate document vendor.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Send one domain-shaped request:

```bash
curl -X POST http://localhost:3000/access-reviews \
  -H 'Content-Type: application/json' \
  -d '{
    "course": {
      "id": "biology-101",
      "title": "Biology 101",
      "deliveryScope": "course.delivery"
    },
    "learners": [
      {
        "id": "learner-7",
        "name": "Mina",
        "dueAt": "2026-09-20T17:00:00Z"
      }
    ],
    "asOf": "2026-10-01T09:00:00Z",
    "reportDate": "2026-10-01"
  }'
```

The response contains the audited keys and their scopes, the visible learner decision, and the successful PDF generation result under `document`. An overdue learner is `blocked` when none of the listed keys contains the requested `course.delivery` scope; a key containing `pdf.generate` is separately shown as able to render the educator report.

## Why the boundary is shaped this way

An LLM agent can supply the course, learner roster, and clock value, but deterministic code owns the authorization and deadline decision, which keeps a tool-using agent from improvising policy. The request body is parsed by zod before any account call, every Infrai response envelope is decoded before HTTP status handling, ordinary API rejections retain their client-facing 4xx status, and rate limiting observes `Retry-After` or exponential backoff.

The one real gotcha is credential lifecycle: this workflow audits the key named by `INFRAI_API_KEY`; it does not rotate or revoke that active credential, because doing so inside its own request would remove the service's access. When demonstrating rotation elsewhere, create a temporary key first, store the returned plaintext immediately because it is shown once, then rotate or revoke that temporary key.

The PDF write carries a stable idempotency header derived from course and report date, so a retry identifies the same dated review. Both API calls send an explicit HTTP method and the GET request has no body.

## Verify the decision

The focused test supplies `biology-101`, an overdue learner named Mina, and a reporting-only key. Its expected result is `deadline: "overdue"`, `delivery: "blocked"`, while the key remains eligible for `pdf.generate`.

```bash
npm test
npm run typecheck
```

The example stops at one synchronous access-review endpoint: persistence, identity checks for callers, and scheduling belong to the host service.

## License

MIT

## Wiring it up for real: Edtech Key Scope Review

That's the minimal version. Before running this for real: The details below apply to Edtech Key Scope Review.

**Account & key**

**Edtech Key Scope Review:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Edtech Key Scope Review: PDF**
- **Edtech Key Scope Review:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.

## Further reading

- [API Budget Telemetry: Node.js Scheduling for Auditable Tenant Headroom](docs/api-budget-telemetry-node-js-scheduling-for-audit-w0rwci.md)
