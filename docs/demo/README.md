# Investor walkthrough

A Playwright recording of the real product against an isolated database.
It does not read `data/nett.db`.

```bash
npm run demo:record
```

Writes `docs/demo/output/nett-investor-demo.mp4` and, in this environment,
`/opt/cursor/artifacts/nett-investor-demo.mp4`.

The cut is silent unless a neural voice (`edge-tts`) is available. Force
silence with `NETT_DEMO_SILENT=1`. Headed Chromium: `NETT_DEMO_HEADED=1`.

Ask uses Ollama when a local model is reachable on loopback. Without it,
Ask still answers from stored evidence.

Messages and WhatsApp cannot refresh on this Linux host. The recorder
presents them as already-owned sources and intercepts Pull so the beat
does not open a Mac-only setup dialog.
