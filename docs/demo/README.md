# Investor walkthrough

A Playwright recording of the real product against an isolated database.
It does not read `data/nett.db`.

```bash
npm run demo:record
```

Writes `docs/demo/output/nett-investor-demo.mp4` and, in this environment,
`/opt/cursor/artifacts/nett-investor-demo.mp4`.

The cut holds the landing, then opens `/today` (no first-run setup,
no About essay). Review is one accept. Sources refresh Messages and
WhatsApp only. Landing’s Spline scene freezes in-page timers in
headless Chromium, so the recorder does not click through that page.

The cut is silent unless a neural voice (`edge-tts`) is available. When
it is, lines are timed to walkthrough beats rather than dumped at the
start. Force silence with `NETT_DEMO_SILENT=1`. Headed Chromium:
`NETT_DEMO_HEADED=1`.

Ask uses Ollama when a local model is reachable on loopback. Without it,
Ask still answers from stored evidence.

Messages and WhatsApp cannot refresh on this Linux host. The recorder
presents them as already-owned sources and intercepts Pull so the beat
does not open a Mac-only setup dialog.
