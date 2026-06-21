# D-Bugger Redaction Layer — Integration Guide

## What this is

Two files that strip PII and secrets out of log content **before** it
leaves the browser and reaches `analyze.js` / the Claude API:

- `redactionEngine.js` — the actual redaction logic. No dependencies.
- `RedactionSummary.jsx` — a small badge that tells the engineer what
  got redacted, so it's never a silent black box. Uses `react-icons`,
  which is already in your project.

Nothing on the server side (`analyze.js`) needs to change. The whole
point is that unredacted content never gets sent in the first place.

## 1. Drop the files in

```
src/utils/redactionEngine.js
src/components/RedactionSummary.jsx
```

## 2. Wire it into the plain-text log formats

This covers Windows Desktop App, Outlook Plugin, IIS, StorageCenter,
and SZC logs — wherever you currently take the filtered/parsed log
text and hand it to the function that calls `analyze.js`.

```js
import { redactText } from '../utils/redactionEngine';

// Before:
// const result = await analyzeWithAI(logContent, format);

// After:
const { redactedText, summary } = redactText(logContent);
const result = await analyzeWithAI(redactedText, format);

// stash `summary` in state and render <RedactionSummary summary={summary} />
// near the AI analysis panel
```

## 3. Wire it into HAR Analyzer

HAR is structured JSON, so use `redactHarObject` instead — it walks
headers, cookies, query strings, and request/response bodies, and
fully redacts anything in `Authorization`, `Cookie`, `Set-Cookie`,
`X-Api-Key`, etc.

```js
import { redactHarObject } from '../utils/redactionEngine';

const { redactedHar, summary } = redactHarObject(parsedHarJson);
const result = await analyzeWithAI(JSON.stringify(redactedHar), 'har');
```

Important: `redactHarObject` returns a **new** object and doesn't
touch the original. That's deliberate — your HAR viewer can keep
showing the engineer the real, unredacted request/response data for
actual troubleshooting. Only what goes to the AI is filtered.

## 4. Show the engineer what happened

```jsx
import RedactionSummary from '../components/RedactionSummary';

<RedactionSummary summary={summary} />
```

Renders nothing if nothing was redacted. Otherwise shows a collapsed
badge like "3 sensitive items redacted before AI analysis" that
expands into a per-category breakdown. This is the part that turns
"we silently mangle your log" into "we show our work" — worth keeping
visible in your portfolio walkthrough.

## What it catches (on by default)

| Category | Strategy | Example |
|---|---|---|
| Email addresses | masked | `j***@acmecorp.com` |
| IPv4 addresses | masked | `203.x.x.x` |
| Authorization headers | removed | `Authorization: [REDACTED]` |
| Bearer tokens | removed | `Bearer [REDACTED-TOKEN]` |
| JWTs | removed | `[REDACTED-JWT]` |
| Cookie / Set-Cookie | removed | `Cookie: [REDACTED]` |
| AWS access keys | removed | `[REDACTED-AWS-KEY]` |
| password / api_key / secret fields | removed | `password=[REDACTED]` |
| Credit card numbers | removed | `[REDACTED-CC]` |
| SSNs | removed | `[REDACTED-SSN]` |
| Phone numbers | **off by default** | too many false positives against ticket/account/session IDs in support logs — flip on in `DEFAULT_REDACTION_CONFIG` if you want it |

Emails and IPs are *masked* rather than fully removed because partial
visibility (domain, subnet) is often what makes the log still useful
for triage. Secrets and tokens are fully removed — there's no
debugging value in a partially-visible API key.

I deliberately did **not** redact GUIDs/session/thread IDs, since
D-Bugger's existing thread-correlation and filtering features depend
on those being intact. If you want a "high paranoia" mode that also
strips those, that's a config flag away, but it'll reduce what the AI
can actually correlate.

## Honest limitations — worth knowing before you call this "done"

- This only protects what goes to the AI call. If there's a
  `console.log(logContent)` anywhere else in the codebase, or the raw
  log gets sent elsewhere (analytics, error reporting), this doesn't
  touch that — worth a quick grep across the codebase.
- Regex-based detection isn't perfect. It will catch the well-known
  patterns above; it won't catch a secret in a format it's never seen
  (e.g. a vendor-specific token format). Treat this as a strong first
  layer, not a guarantee.
- No tests are included yet — `test.mjs`-style logic was validated by
  hand against sample data, but you'll want real ShareFile log samples
  run through it before you trust it on customer data.

## Quick test

```js
import { redactText } from './redactionEngine';

const { redactedText, summary } = redactText(`
Authorization: Bearer abc123
User john@acmecorp.com logged in from 203.45.67.89
`);

console.log(redactedText);
// Authorization: [REDACTED]
// User j***@acmecorp.com logged in from 203.x.x.x

console.log(summary.totalRedactions); // 3
```
