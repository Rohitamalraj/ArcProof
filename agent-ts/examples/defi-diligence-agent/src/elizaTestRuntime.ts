/**
 * A minimal stand-in for an ElizaOS IAgentRuntime, for running this
 * example without booting a full ElizaOS character + model plugin. It
 * implements the ONE method the native @arcproof/sdk-elizaos builders use
 * -- useModel(ModelType.OBJECT_LARGE, { prompt, schema }) -- by calling a
 * real LLM through its OpenAI-compatible JSON endpoint (Groq, else Gemini).
 *
 * IMPORTANT for the "standalone" claim: this file imports NO LangChain and
 * NO @arcproof/sdk-langchain. In a real ElizaOS deployment you would NOT
 * write this at all -- `runtime.useModel` is provided by the character's
 * own model plugin (@elizaos/plugin-openai, -groq, etc.). This is purely a
 * test harness implementing the same useModel contract so the native
 * gatherer/orchestrator code can be exercised end to end here.
 */
interface OpenAICompatConfig {
  url: string;
  model: string;
  apiKey: string;
}

function providerConfig(): OpenAICompatConfig {
  if (process.env.GROQ_API_KEY) {
    return { url: "https://api.groq.com/openai/v1/chat/completions", model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", apiKey: process.env.GROQ_API_KEY };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { url: "https://openrouter.ai/api/v1/chat/completions", model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free", apiKey: process.env.OPENROUTER_API_KEY };
  }
  if (process.env.GOOGLE_API_KEY) {
    return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.5-flash-lite", apiKey: process.env.GOOGLE_API_KEY };
  }
  throw new Error("No LLM configured for the test runtime -- set GROQ_API_KEY, OPENROUTER_API_KEY, or GOOGLE_API_KEY");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeElizaTestRuntime() {
  const cfg = providerConfig();
  return {
    async useModel(_modelType: string, params: { prompt: string; schema?: unknown; temperature?: number }): Promise<unknown> {
      // Retry transient per-minute 429s (common on free tiers) a few times
      // with the server-suggested delay -- a test-harness concern, not part
      // of the SDK contract. A real ElizaOS model plugin handles its own
      // provider rate limits.
      for (let attempt = 0; attempt < 4; attempt++) {
        const resp = await fetch(cfg.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: params.prompt }],
            response_format: { type: "json_object" },
            temperature: params.temperature ?? 0,
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { choices: { message: { content: string } }[] };
          return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
        }
        const body = await resp.text();
        if (resp.status === 429 && attempt < 3) {
          const retryAfter = Number(resp.headers.get("retry-after")) || 22;
          console.log(`[test-runtime] 429 rate-limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/3)...`);
          await sleep(Math.min(retryAfter, 30) * 1000);
          continue;
        }
        throw new Error(`model call failed: ${resp.status} ${body}`);
      }
      throw new Error("model call failed: exhausted retries");
    },
  };
}
