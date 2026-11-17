# Development

```sh
bun install
bun test
```

The desktop part is a prebuilt bundle: run `bun run build` (or `bun run dev` while changing it). `dist/` is not committed, so build after a fresh clone. The server part exposes the watches and PR lists over RPC (`rpc.ts`, with a `changed` event); the desktop part (`src/gui.tsx`, the experimental GUI plugin API) reads them.

Publishing: `npm publish` runs the tests and builds the bundle first (`prepublishOnly`).

## Demo mode (for screenshots)

With the localStorage flag `pr-watch.demo` set to `"true"`, the pill and the PRs tab show made-up PRs and watches (`core/demo.ts`) instead of your own, and actions do nothing. Set it in the desktop app's developer console with `localStorage.setItem("pr-watch.demo", "true")`, reload, and remove it again with `localStorage.removeItem("pr-watch.demo")`.
