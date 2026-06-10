import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleAnalyze } from "./server/analyzeHandler.js";

function analyzeApiPlugin(env) {
  return {
    name: "analyze-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/api/analyze" || req.method !== "POST") {
          return next();
        }

        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const result = await handleAnalyze(body, env.ANTHROPIC_API_KEY);
            res.statusCode = result.status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result.body));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message || "Internal server error" }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), analyzeApiPlugin(env)],
    server: {
      port: 5173,
      open: true,
    },
  };
});
