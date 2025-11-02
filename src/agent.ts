import { z } from "zod";
import {
  createAgentApp,
  createAxLLMClient,
  AgentKitConfig,
} from "@lucid-dreams/agent-kit";
import { ai } from "@ax-llm/ax";

/**
 * This agent combines live exchange-rate data with optional AxLLM summaries.
 * Configure OPENAI_API_KEY (or compatible AxLLM env vars) to enable the
 * market-summary entrypoint; set ENABLE_PAYMENTS=true to run through x402.
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

const DEFAULT_AX_MODEL = "gpt-4o-mini" as const;

type AxModelConfig = {
  model: typeof DEFAULT_AX_MODEL;
  stream: boolean;
  temperature?: number;
};

const axApiUrl =
  process.env.AX_API_URL ??
  process.env.AXLLM_API_URL ??
  process.env.OPENAI_API_URL;

const axTemperatureValue =
  process.env.AX_TEMPERATURE ??
  process.env.AXLLM_TEMPERATURE ??
  process.env.OPENAI_TEMPERATURE;

const parsedAxTemperature =
  axTemperatureValue && axTemperatureValue.trim().length > 0
    ? Number(axTemperatureValue)
    : undefined;

const baseAxConfig: AxModelConfig = {
  model: DEFAULT_AX_MODEL,
  stream: false,
};

if (
  parsedAxTemperature !== undefined &&
  Number.isFinite(parsedAxTemperature)
) {
  baseAxConfig.temperature = parsedAxTemperature;
}

const directAxClient = paymentsEnabled
  ? null
  : createNonPaywalledAxClient(baseAxConfig, axApiUrl);

const axClient = createAxLLMClient({
  model: DEFAULT_AX_MODEL,
  ...(directAxClient ? { clientFactory: () => directAxClient } : {}),
  x402: {
    model: DEFAULT_AX_MODEL,
    ai: {
      config: { ...baseAxConfig },
    },
  },
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
    name: "USD Currency Converter",
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

function mapRatesFromRecord(rateRecord: Record<string, number>) {
  return TOP_CURRENCIES.map((currency) => {
    const rate = rateRecord[currency];
    if (typeof rate !== "number" || Number.isNaN(rate)) {
      throw new Error(`Missing rate for ${currency}.`);
    }

    return { currency, rate };
  });
}

function createNonPaywalledAxClient(
  config: AxModelConfig,
  apiUrl?: string
): ReturnType<typeof ai> | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  return ai(
    {
      name: "openai",
      apiKey,
      ...(apiUrl ? { apiURL: apiUrl } : {}),
      config,
    } as any
  );
}

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
    const rates = mapRatesFromRecord(providerRates);

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

const TONE_OPTIONS = ["neutral", "optimistic", "cautious"] as const;

addEntrypoint({
  key: "usd-market-summary",
  description:
    "Generate a short market brief for USD conversion rates using an LLM.",
  ...(paymentsEnabled ? { price: "0.005" } : {}),
  input: z.object({
    focus: z
      .string()
      .max(240, "Focus must be 240 characters or fewer.")
      .optional(),
    tone: z.enum(TONE_OPTIONS).optional(),
  }),
  output: z.object({
    base: z.literal("USD"),
    updatedAt: z.string(),
    summary: z.string(),
    highlights: z.array(z.string()),
    dataProvider: z.string(),
    rates: z.array(
      z.object({
        currency: z.string(),
        rate: z.number(),
      })
    ),
  }),
  async handler({ input }) {
    const ai = axClient.ax;
    if (!ai || !axClient.isConfigured()) {
      throw new Error(
        "LLM provider is not configured. Set OPENAI_API_KEY to enable market summaries."
      );
    }

    const { rates: providerRates, updatedAt, provider } = await fetchUsdRates();
    const rates = mapRatesFromRecord(providerRates);
    const timestamp =
      typeof updatedAt === "string"
        ? updatedAt
        : new Date().toISOString();

    const focus = input?.focus?.trim();
    const tone = input?.tone ?? "neutral";
    const toneInstruction =
      tone === "neutral"
        ? "Keep the tone neutral and factual."
        : `Adopt a ${tone} tone while staying factual.`;

    const rateLines = rates
      .map((entry) => `${entry.currency}: ${entry.rate.toFixed(4)}`)
      .join("\n");

    const userPrompt = [
      `Latest USD conversion rates (base USD) as of ${timestamp}:`,
      rateLines,
      focus
        ? `Caller focus: ${focus}`
        : "Highlight notable moves and practical implications for a general audience.",
      toneInstruction,
      'Respond with JSON matching {"summary": string, "highlights": string[]} with no extra commentary.',
    ].join("\n\n");

    const response = await ai.chat({
      chatPrompt: [
        {
          role: "system",
          content:
            "You are a financial analyst writing concise foreign exchange updates. Respond ONLY with JSON containing keys \"summary\" and \"highlights\".",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const primaryResult = Array.isArray(response.results)
      ? response.results[0]
      : undefined;
    const rawContent =
      typeof primaryResult?.content === "string"
        ? primaryResult.content.trim()
        : "";

    if (!rawContent) {
      throw new Error("LLM did not return any content.");
    }

    let summary = rawContent;
    let highlights: string[] = [];

    try {
      const parsed = JSON.parse(rawContent) as {
        summary?: unknown;
        highlights?: unknown;
      };
      if (typeof parsed.summary === "string") {
        summary = parsed.summary.trim();
      }
      if (Array.isArray(parsed.highlights)) {
        highlights = parsed.highlights
          .map((item: unknown) => String(item).trim())
          .filter((item: string) => item.length > 0);
      }
    } catch {
      const lines = rawContent
        .split(/\n+/)
        .map((line: string) => line.replace(/^[\-\*\d\.\s]+/, "").trim())
        .filter((line: string) => line.length > 0);
      if (lines.length > 0) {
        summary = lines[0];
        highlights = lines.slice(1, 4);
      }
    }

    if (highlights.length === 0) {
      highlights = rates
        .slice(0, 3)
        .map(
          (entry) => `USD/${entry.currency} trades near ${entry.rate.toFixed(4)}.`
        );
    }

    return {
      output: {
        base: "USD",
        updatedAt: timestamp,
        summary,
        highlights,
        dataProvider: provider,
        rates,
      },
      model: ai.getName() ?? provider,
    };
  },
});

export { app };
