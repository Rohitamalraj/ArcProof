/**
 * Shared LLM model selection for every LangChain.js agent in this project
 * (orchestrator planner/memo writer, the three specialists) -- one place to
 * pick the model so every true agent uses the same provider fallback
 * order. Ported from agent/agents/llm.py.
 *
 * Note: unlike the Python evaluator, this project's evaluator (core's
 * evaluator.ts) is deterministic code with no LLM call at all -- getModel
 * is only used by the orchestrator's planner and the 3 specialists, whose
 * *claim-gathering* stays genuinely agentic (that part of the PRD
 * deviation was fine; only the evaluator's verdict needed to become
 * rule-based).
 *
 * Deliberately no non-LLM return value: every caller is a real
 * tool-calling LangChain.js agent, not a rule-based fallback wearing an
 * agent's name.
 */
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGroq } from "@langchain/groq";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { config } from "@arcproof/core";

export function getModel(role: string): BaseChatModel {
  // Checked first of all: Groq's free tier has much more generous
  // per-minute/per-day limits than Gemini's 20/day or OpenRouter's free
  // model pool, and its hosted Llama models have solid native tool-calling
  // support -- added after both of those got exhausted/rate-limited
  // mid-demo.
  if (config.GROQ_API_KEY) {
    return new ChatGroq({ model: config.GROQ_MODEL, apiKey: config.GROQ_API_KEY }) as unknown as BaseChatModel;
  }
  // OpenRouter is OpenAI-API-compatible, so it's just ChatOpenAI pointed at
  // OpenRouter's baseURL. Added specifically to route every agent around
  // Gemini's free-tier daily quota (20 requests/day/key) once it got
  // exhausted mid-demo -- takes priority over the Google keys below so the
  // whole system runs on one working provider rather than a patchwork of
  // some agents on Gemini, some not.
  if (config.OPENROUTER_API_KEY) {
    return new ChatOpenAI({
      model: config.OPENROUTER_MODEL,
      apiKey: config.OPENROUTER_API_KEY,
      configuration: { baseURL: "https://openrouter.ai/api/v1" },
      // 2048 is plenty for a short structured JSON response (a handful of
      // claims, or a short plan/memo) without over-requesting against a
      // free model's own context budget.
      maxTokens: 2048,
    }) as unknown as BaseChatModel;
  }
  const googleKey = config.GOOGLE_API_KEYS_BY_ROLE[role] || "";
  if (googleKey) {
    return new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash-lite", apiKey: googleKey }) as unknown as BaseChatModel;
  }
  if (config.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({ model: "claude-sonnet-4-5", apiKey: config.ANTHROPIC_API_KEY }) as unknown as BaseChatModel;
  }
  if (config.OPENAI_API_KEY) {
    return new ChatOpenAI({ model: "gpt-4o-mini", apiKey: config.OPENAI_API_KEY }) as unknown as BaseChatModel;
  }
  throw new Error(
    `No LLM configured for role '${role}' -- set GROQ_API_KEY, OPENROUTER_API_KEY, GOOGLE_API_KEY (or a ` +
      `role-specific GOOGLE_API_KEY_* variant, free, aistudio.google.com/apikey), ANTHROPIC_API_KEY, or ` +
      `OPENAI_API_KEY in .env. The orchestrator's planner and every specialist are real LLM tool-calling agents ` +
      `and need a real model to ask.`
  );
}
