const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export async function handleAnalyze(body, apiKey, model = DEFAULT_MODEL) {
  const { system, userMsg, max_tokens = 1400 } = body ?? {};

  if (!apiKey) {
    return {
      status: 503,
      body: {
        error:
          "ANTHROPIC_API_KEY is not set. Create a .env file in the project root with ANTHROPIC_API_KEY=sk-ant-... and restart the dev server.",
      },
    };
  }

  if (!userMsg?.trim()) {
    return { status: 400, body: { error: "Missing userMsg in request body." } };
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || model,
      max_tokens,
      system: system || "You are a helpful assistant.",
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      data?.error?.message || data?.message || response.statusText || "Unknown error";
    return {
      status: response.status,
      body: { error: `Anthropic API error: ${detail}` },
    };
  }

  const text =
    data.content?.find((block) => block.type === "text")?.text?.trim() ||
    "No analysis returned.";

  return { status: 200, body: { text } };
}
