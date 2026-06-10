import { handleAnalyze } from "../../server/analyzeHandler.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const result = await handleAnalyze(body, process.env.GEMINI_API_KEY);
    return {
      statusCode: result.status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.body),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Internal server error" }),
    };
  }
};
