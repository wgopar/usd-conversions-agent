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

const paymentsConfig: NonNullable<AgentKitConfig["payments"]> = {
  facilitatorUrl:
    (process.env.FACILITATOR_URL as any) ??
    "https://facilitator.daydreams.systems",
  payTo:
    (process.env.PAY_TO as `0x${string}`) ??
    "0xb308ed39d67D0d4BAe5BC2FAEF60c66BBb6AE429",
  network: (process.env.NETWORK as any) ?? "base",
  defaultPrice: process.env.DEFAULT_PRICE ?? "1000",
};

const paymentsEnabled = process.env.ENABLE_PAYMENTS === "true";

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
  paymentsEnabled
    ? {
        config: {
          payments: paymentsConfig,
        },
      }
    : {
        payments: false,
      }
);

const TOP_CURRENCIES = ["EUR", "CNY", "JPY", "GBP", "AUD"] as const;

type RatesResult = {
  rates: Record<string, number>;
  updatedAt?: string;
  provider: string;
};

async function fetchUsdRates(): Promise<RatesResult> {
  try {
    return await fetchFromOpenErApi();
  } catch (primaryError) {
    const primaryMessage =
      primaryError instanceof Error
        ? primaryError.message
        : String(primaryError);
    console.warn(
      `[usd-conversions] primary rates provider failed: ${primaryMessage}`
    );

    try {
      return await fetchFromJsDelivr();
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new Error(
        `Unable to fetch USD conversion rates from available providers (primary: ${primaryMessage}; fallback: ${fallbackMessage}).`
      );
    }
  }
}

async function fetchFromOpenErApi(): Promise<RatesResult> {
  const response = await fetch("https://open.er-api.com/v6/latest/USD");
  const payload = (await response.json()) as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };

  if (!response.ok) {
    throw new Error(
      `open.er-api responded with unexpected status ${response.status}.`
    );
  }

  if (payload.result !== "success" || !payload.rates) {
    throw new Error("open.er-api response did not contain USD rate data.");
  }

  const rates: Record<string, number> = {};
  for (const currency of TOP_CURRENCIES) {
    const rate = payload.rates[currency];
    if (typeof rate !== "number" || Number.isNaN(rate)) {
      throw new Error(`open.er-api missing rate for ${currency}.`);
    }
    rates[currency] = rate;
  }

  return {
    rates,
    updatedAt: payload.time_last_update_utc,
    provider: "open.er-api",
  };
}

async function fetchFromJsDelivr(): Promise<RatesResult> {
  const response = await fetch(
    "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/usd.json"
  );
  const payload = (await response.json()) as {
    date?: string;
    usd?: Record<string, number>;
  };

  if (!response.ok) {
    throw new Error(
      `jsDelivr currency API responded with unexpected status ${response.status}.`
    );
  }

  if (!payload.usd) {
    throw new Error("jsDelivr currency API response did not include usd rates.");
  }

  const rates: Record<string, number> = {};
  for (const currency of TOP_CURRENCIES) {
    const rate = payload.usd[currency.toLowerCase()];
    if (typeof rate !== "number" || Number.isNaN(rate)) {
      throw new Error(`jsDelivr currency API missing rate for ${currency}.`);
    }
    rates[currency] = rate;
  }

  return {
    rates,
    updatedAt: payload.date,
    provider: "fawazahmed0/currency-api",
  };
}

addEntrypoint({
  key: "usd-conversions",
  description:
    "Fetch the latest USD conversion rates for five globally traded currencies.",
  ...(paymentsEnabled ? { price: "0.001" } : {}),
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
    const { rates: providerRates, updatedAt, provider } = await fetchUsdRates();
    const rates = TOP_CURRENCIES.map((currency) => {
      const rate = providerRates?.[currency];
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
          typeof updatedAt === "string"
            ? updatedAt
            : new Date().toISOString(),
      },
      model: provider,
    };
  },
});

export { app };
