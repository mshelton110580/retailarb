import Anthropic from "@anthropic-ai/sdk";

declare global {
  var _anthropic: Anthropic | undefined;
}

export function getAnthropicClient(): Anthropic {
  if (global._anthropic) return global._anthropic;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const client = new Anthropic({ apiKey, maxRetries: 5 });

  if (process.env.NODE_ENV !== "production") {
    global._anthropic = client;
  }

  return client;
}
