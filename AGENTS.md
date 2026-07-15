<!-- BEGIN:nextjs-agent-rules -->
# Frontend Toolchain: Deno + Next.js 16

## Runtime

- **Deno 2.9.2** is the JavaScript/TypeScript runtime and package manager.
  `node` is NOT available — never use npm, npx, node, or package.json scripts directly.
- All JS/TS files run with Deno's built-in TypeScript support (no tsc config needed).

## Commands

| Action | Command |
|--------|---------|
| Install deps | `deno install --allow-scripts` |
| Dev server | `deno task dev` |
| Production build | `deno task build` (static export to `out/`) |
| Format code | `deno fmt` |
| Lint | `deno lint` |

## Configuration

- **`deno.json`** — project config (tasks, unstable flags, compiler options)
- **`next.config.mjs`** — Next.js config (static export mode: `output: "export"`)
- **`package.json`** — kept only for npm dependency declarations; Deno reads it
- **`node_modules/`** — exists because Next.js requires it; managed by `deno install`
- Dependencies use `npm:` specifiers (e.g. `npm:next@16`, `npm:react@19`)

## API Calls

- Frontend uses **relative API paths** (`/api/mdoc/scan`, `/api/preview/...`)
- In dev mode, set `NEXT_PUBLIC_API_BASE=http://localhost:8000` in `.env.local`
- In production, the Rust backend serves both the API and the static frontend on one port

## Key Deno flags in deno.json

```json
{
  "unstable": ["detect-cjs", "node-globals", "unsafe-proto", "sloppy-imports"],
  "nodeModulesDir": "auto"
}
```

## Deployment

- Build the release tarball: `./build-release.sh` (from project root)
- This runs `cargo build --release` and `deno task build`, then packages everything
- The tarball is fully self-contained — no Rust or Deno needed on the target machine
<!-- END:nextjs-agent-rules -->
