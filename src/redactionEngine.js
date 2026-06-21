/**
 * D-Bugger Redaction Engine
 * ---------------------------------------------------------------
 * Strips or masks PII and secrets from log content BEFORE it is
 * sent to the AI analysis endpoint (netlify/functions/analyze.js).
 *
 * Runs entirely client-side. Wired into callAI() in App.jsx, so
 * every tab's AI analysis call passes through this automatically.
 */

// ---- Pattern definitions ---------------------------------------------
// strategy 'mask'   -> partially visible replacement (keeps debugging value)
// strategy 'remove' -> whole match replaced with a [REDACTED-X] tag

const PATTERNS = {
  email: {
    label: 'Email address',
    enabled: true,
    strategy: 'mask',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    mask: (match) => {
      const [user, domain] = match.split('@');
      return `${user.slice(0, 1)}***@${domain}`;
    }
  },

  ipv4: {
    label: 'IPv4 address',
    enabled: true,
    strategy: 'mask',
    regex: /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g,
    mask: (match, p1) => `${p1}.x.x.x`
  },

  authHeader: {
    label: 'Authorization header',
    enabled: true,
    strategy: 'remove',
    regex: /Authorization:\s*\S.*$/gim,
    tag: () => 'Authorization: [REDACTED]'
  },

  bearerToken: {
    label: 'Bearer token',
    enabled: true,
    strategy: 'remove',
    regex: /Bearer\s+[A-Za-z0-9\-_.]+/g,
    tag: () => 'Bearer [REDACTED-TOKEN]'
  },

  jwt: {
    label: 'JWT token',
    enabled: true,
    strategy: 'remove',
    regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    tag: () => '[REDACTED-JWT]'
  },

  cookie: {
    label: 'Cookie header',
    enabled: true,
    strategy: 'remove',
    regex: /(Set-)?Cookie:\s*\S.*$/gim,
    tag: (match) =>
      match.toLowerCase().startsWith('set-cookie')
        ? 'Set-Cookie: [REDACTED]'
        : 'Cookie: [REDACTED]'
  },

  awsKey: {
    label: 'AWS access key',
    enabled: true,
    strategy: 'remove',
    regex: /AKIA[0-9A-Z]{16}/g,
    tag: () => '[REDACTED-AWS-KEY]'
  },

  secretAssignment: {
    label: 'Secret/password field',
    enabled: true,
    strategy: 'remove',
    regex: /(api[_-]?key|apikey|client[_-]?secret|secret[_-]?key|password|pwd|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{6,}["']?/gi,
    tag: (match) => `${match.split(/[:=]/)[0]}=[REDACTED]`
  },

  creditCard: {
    label: 'Credit card number',
    enabled: true,
    strategy: 'remove',
    regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    tag: () => '[REDACTED-CC]'
  },

  ssn: {
    label: 'SSN',
    enabled: true,
    strategy: 'remove',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    tag: () => '[REDACTED-SSN]'
  },

  // Off by default: too many false positives against ticket/account/session
  // numbers in support logs. Flip to true in DEFAULT_REDACTION_CONFIG if needed.
  phone: {
    label: 'Phone number',
    enabled: false,
    strategy: 'mask',
    regex: /\b(\+?1[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/g,
    mask: (match) => match.slice(0, 3) + '-***-' + match.slice(-4)
  }
};

// HAR header names whose values are always fully redacted, regardless of content.
// Not currently exercised by App.jsx (the HAR tab only sends url/method/status/time
// to the AI, not raw headers) but kept here for when header data is forwarded.
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization', 'cookie', 'set-cookie', 'proxy-authorization',
  'x-api-key', 'x-auth-token', 'x-csrf-token', 'x-session-token'
]);

export const DEFAULT_REDACTION_CONFIG = Object.fromEntries(
  Object.entries(PATTERNS).map(([key, def]) => [key, def.enabled])
);

/**
 * Redact a raw text string before it's sent to the AI. Used for every
 * tab's userMsg — Log Analyzer, Correlate, API Tracer, and HAR Analyzer
 * all funnel through this via callAI() in App.jsx.
 */
export function redactText(text, config = DEFAULT_REDACTION_CONFIG) {
  if (!text) return { redactedText: text, summary: emptySummary() };

  let redacted = text;
  const byCategory = {};

  for (const [key, def] of Object.entries(PATTERNS)) {
    if (!config[key]) continue;
    let count = 0;

    redacted = redacted.replace(def.regex, (...args) => {
      count++;
      return def.strategy === 'mask' ? def.mask(...args) : def.tag(args[0]);
    });

    if (count > 0) byCategory[def.label] = count;
  }

  const totalRedactions = Object.values(byCategory).reduce((a, b) => a + b, 0);
  return { redactedText: redacted, summary: { totalRedactions, byCategory } };
}

/**
 * Redact a parsed HAR object before it's serialized into the AI prompt.
 * Returns a NEW object — the original is untouched, so the on-screen
 * HAR viewer can keep showing full data while only the AI payload is
 * filtered. Available for future use if the HAR/API Tracer tabs start
 * forwarding raw headers/cookies/bodies to the AI.
 */
export function redactHarObject(har, config = DEFAULT_REDACTION_CONFIG) {
  const summary = emptySummary();

  const redactHeaderArray = (headers = []) =>
    headers.map((h) => {
      if (SENSITIVE_HEADER_NAMES.has((h.name || '').toLowerCase())) {
        bump(summary, 'Sensitive header');
        return { ...h, value: '[REDACTED]' };
      }
      const { redactedText, summary: s } = redactText(h.value || '', config);
      mergeSummary(summary, s);
      return { ...h, value: redactedText };
    });

  const redactQueryString = (params = []) =>
    params.map((q) => {
      if (/key|token|secret|password|auth/i.test(q.name || '')) {
        bump(summary, 'Sensitive query parameter');
        return { ...q, value: '[REDACTED]' };
      }
      const { redactedText, summary: s } = redactText(q.value || '', config);
      mergeSummary(summary, s);
      return { ...q, value: redactedText };
    });

  const redactBody = (body) => {
    if (!body) return body;
    const { redactedText, summary: s } = redactText(body, config);
    mergeSummary(summary, s);
    return redactedText;
  };

  const clone = JSON.parse(JSON.stringify(har));
  const entries = clone?.log?.entries || [];

  for (const entry of entries) {
    if (entry.request) {
      entry.request.headers = redactHeaderArray(entry.request.headers);
      entry.request.cookies = (entry.request.cookies || []).map((c) => ({ ...c, value: '[REDACTED]' }));
      if (entry.request.queryString) entry.request.queryString = redactQueryString(entry.request.queryString);
      if (entry.request.postData?.text) entry.request.postData.text = redactBody(entry.request.postData.text);
      if (entry.request.url) entry.request.url = redactText(entry.request.url, config).redactedText;
    }
    if (entry.response) {
      entry.response.headers = redactHeaderArray(entry.response.headers);
      entry.response.cookies = (entry.response.cookies || []).map((c) => ({ ...c, value: '[REDACTED]' }));
      if (entry.response.content?.text) entry.response.content.text = redactBody(entry.response.content.text);
    }
  }

  return { redactedHar: clone, summary };
}

function bump(summary, label) {
  summary.totalRedactions++;
  summary.byCategory[label] = (summary.byCategory[label] || 0) + 1;
}

function mergeSummary(target, source) {
  target.totalRedactions += source.totalRedactions;
  for (const [label, count] of Object.entries(source.byCategory)) {
    target.byCategory[label] = (target.byCategory[label] || 0) + count;
  }
}

function emptySummary() {
  return { totalRedactions: 0, byCategory: {} };
}