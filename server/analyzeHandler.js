const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const NVIDIA_API_URL    = "https://integrate.api.nvidia.com/v1/chat/completions";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_NVIDIA_MODEL    = "meta/llama-3.1-70b-instruct";

// Shared response-shape so callers never need to know which provider fired
function ok(text, provider, model) {
  return { status: 200, body: { text, provider, model } };
}
function err(status, message) {
  return { status, body: { error: message } };
}

async function callAnthropic({ system, userMsg, max_tokens }, apiKey) {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens,
      system: system || "You are a helpful assistant.",
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || data?.message || res.statusText || "Unknown error";
    return err(res.status, `Anthropic API error: ${detail}`);
  }
  const text = data.content?.find((b) => b.type === "text")?.text?.trim() || "No analysis returned.";
  return ok(text, "anthropic", model);
}

async function callNvidia({ system, userMsg, max_tokens, nvidiaModel }, apiKey) {
  const model = nvidiaModel || DEFAULT_NVIDIA_MODEL;
  const res = await fetch(NVIDIA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [
        { role: "system", content: system || "You are a helpful assistant." },
        { role: "user",   content: userMsg },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.error?.message || data?.message || res.statusText || "Unknown error";
    return err(res.status, `NVIDIA NIM API error: ${detail}`);
  }
  const text = data.choices?.[0]?.message?.content?.trim() || "No analysis returned.";
  return ok(text, "nvidia", model);
}

export async function handleAnalyze(body, anthropicKey, nvidiaKey) {
  const { system, userMsg, max_tokens = 1400, provider = "anthropic", nvidiaModel } = body ?? {};

  if (!userMsg?.trim()) return err(400, "Missing userMsg in request body.");

  if (provider === "nvidia") {
    if (!nvidiaKey) return err(503, "NVIDIA_API_KEY is not set. Add NVIDIA_API_KEY=nvapi-... to your .env file and restart the dev server.");
    return callNvidia({ system, userMsg, max_tokens, nvidiaModel }, nvidiaKey);
  }

  // Default: Anthropic
  if (!anthropicKey) return err(503, "ANTHROPIC_API_KEY is not set. Add ANTHROPIC_API_KEY=sk-ant-... to your .env file and restart the dev server.");
  return callAnthropic({ system, userMsg, max_tokens }, anthropicKey);
}
