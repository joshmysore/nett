# Investor walkthrough

A Playwright recording of the real product against an isolated database.
It does not read `data/nett.db`.

```bash
npm run demo:record
```

Writes `docs/demo/output/nett-investor-demo.mp4` and, in this environment,
`/opt/cursor/artifacts/nett-investor-demo.mp4`.

Landing holds about fifteen seconds with the Spline robot hidden — it
glitches in headless Chromium. The workbench then shows People, a short
Review accept, Messages and WhatsApp pull, Kendra’s profile, Gilly’s
drawer, and Ask.

Ask is a paced stand-in of the real agent UI: thinking stages, sources,
cited evidence, and full paragraphs. First question is a Kendra brief.
Second is a synthesis: who would be a good lead for legal tech.

Punch-in zoom is used only a few times. Other clicks are a move and a
ripple. Neural voiceover is timed to beats when `edge-tts` is available.
`NETT_DEMO_SILENT=1` forces a silent cut. Headed Chromium:
`NETT_DEMO_HEADED=1`.
