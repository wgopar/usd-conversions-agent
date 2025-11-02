## dreams

This project was scaffolded with `create-agent-kit` and ships with a ready-to-run agent app built on [`@lucid-dreams/agent-kit`](https://www.npmjs.com/package/@lucid-dreams/agent-kit).

### Quick start

```sh
bun install
bun run dev
```

The dev command runs `bun` in watch mode, starts the HTTP server, and reloads when you change files inside `src/`.

### Project structure

- `src/agent.ts` – defines your agent manifest and entrypoints.
- `src/index.ts` – boots a Bun HTTP server with the agent.

### Available scripts

- `bun run dev` – start the agent in watch mode.
- `bun run start` – start the agent once.
- `bun run agent` – run the agent module directly (helpful for quick experiments).
- `bunx tsc --noEmit` – type-check the project.

### Agent entrypoints

- `usd-conversions` – returns the latest USD→EUR/CNY/JPY/GBP/AUD rates pulled from free public APIs.
- `usd-market-summary` – generates a short FX brief with highlights using your configured AxLLM provider (`OPENAI_API_KEY` or compatible); falls back to the rate data above when summarising.

### Next steps

- Update `src/agent.ts` with your use case.
- Wire up `@lucid-dreams/agent-kit` configuration and secrets (see `AGENTS.md` in the repo for details).
- Copy `.env.example` to `.env` and fill in the values for your environment.
- Deploy with your preferred Bun-compatible platform when you're ready.

### Currency data

Live USD rates come from `https://open.er-api.com/v6/latest/USD`, with a fallback to the public `fawazahmed0/currency-api` snapshot when the primary source is unavailable. Both sources are keyless. The market-summary entrypoint simply layers an AxLLM-generated narrative on top of the same data.
