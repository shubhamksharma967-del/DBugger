const GEMINI_API_URL = "https://api.gemini.google.com/v1/models/gemini-2.0-flash/generateContent";
const DEFAULT_MODEL = "gemini-2.0-flash";

export async function handleAnalyze(body, apiKey, model = DEFAULT_MODEL) {
  const { system, userMsg, max_tokens = 1400 } = body ?? {};

  if (!apiKey) {
    return {
      status: 503,
      body: {
        error:
          "GEMINI_API_KEY is not set. Create a .env file in the project root with GEMINI_API_KEY=sk-ant-... and restart the dev server.",
      },
    };
  }

  if (!userMsg?.trim()) {
    return { status: 400, body: { error: "Missing userMsg in request body." } };
  }

  const response = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "gemini-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL || model,
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
      body: { error: `Gemini API error: ${detail}` },
    };
  }

  const text =
    data.content?.find((block) => block.type === "text")?.text?.trim() ||
    "No analysis returned.";

  return { status: 200, body: { text } };
}
