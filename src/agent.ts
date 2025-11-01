import { z } from "zod";
import {
  createAgentApp,
  createAxLLMClient,
  AgentKitConfig,
} from "@lucid-dreams/agent-kit";
import { flow } from "@ax-llm/ax";

/**
 * This example shows how to combine `createAxLLMClient` with a small AxFlow
 * pipeline. The flow creates a short summary for a topic and then follows up
 * with a handful of ideas the caller could explore next.
 *
 * Required environment variables:
 *   - OPENAI_API_KEY   (passed through to @ax-llm/ax)
 *   - PRIVATE_KEY      (used for x402 payments)
 */

const configOverrides: AgentKitConfig = {
  payments: {
    facilitatorUrl:
      (process.env.FACILITATOR_URL as any) ??
      "https://facilitator.daydreams.systems",
    payTo:
      (process.env.PAY_TO as `0x${string}`) ??
      "0xb308ed39d67D0d4BAe5BC2FAEF60c66BBb6AE429",
    network: (process.env.NETWORK as any) ?? "base",
    defaultPrice: process.env.DEFAULT_PRICE ?? "1000",
  },
};

const axClient = createAxLLMClient({
  logger: {
    warn(message: string, error?: unknown) {
      if (error) {
        console.warn(`[examples] ${message}`, error);
      } else {
        console.warn(`[examples] ${message}`);
      }
    },
  },
});

if (!axClient.isConfigured()) {
  console.warn(
    "[examples] Ax LLM provider not configured — the flow will fall back to scripted output."
  );
}

const { app, addEntrypoint } = createAgentApp(
  {
    name: "usd-conversions-agent",
    version: "0.0.1",
    description:
      "Fetch the latest USD conversion rates for five globally traded currencies: EUR, CNY, JPY, GBP, and AUD.",
  },
  {
    config: configOverrides,
  }
);

const TOP_CURRENCIES = ["EUR", "CNY", "JPY", "GBP", "AUD"] as const;

addEntrypoint({
  key: "usd-conversions",
  description:
    "Fetch the latest USD conversion rates for five globally traded currencies.",
  price: "0.002",
  input: z.object({}),
  output: z.object({
    base: z.literal("USD"),
    rates: z.array(
      z.object({
        currency: z.string(),
        rate: z.number(),
      })
    ),
    updatedAt: z.string(),
  }),
  async handler() {
    const symbols = TOP_CURRENCIES.join(",");
    const response = await fetch(
      `https://api.exchangerate.host/latest?base=USD&symbols=${symbols}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to retrieve currency data (status ${response.status}).`
      );
    }

    const payload = (await response.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };

    if (!payload.rates) {
      throw new Error("Currency response did not contain rate information.");
    }

    const rates = TOP_CURRENCIES.map((currency) => {
      const rate = payload.rates?.[currency];
      if (typeof rate !== "number" || Number.isNaN(rate)) {
        throw new Error(`Missing rate for ${currency}.`);
      }

      return { currency, rate };
    });

    return {
      output: {
        base: "USD",
        rates,
        updatedAt:
          typeof payload.date === "string"
            ? payload.date
            : new Date().toISOString(),
      },
      model: "exchangerate.host",
    };
  },
});

export { app };
