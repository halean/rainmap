# Working notes / in-progress state

Not user-facing docs -- context for whoever (human or Claude) picks this repo
back up next. See `README.md` for how the system actually works.

## Vision-LLM cost comparison -- done

Ran a real three-way cost/quality comparison on 60 identical storm-camera
frames (same prompt, same images) to price out alternatives to the free Gemma
pipeline:

| Provider | Real cost (standard/batch) | $/call | Rain calls / 60 |
|---|---|---|---|
| Gemma (production) | $0 | $0 | n/a |
| GPT-6 Astra | $0.66 / $0.33 | $0.011 | 3 |
| Gemini 3.8 Flash (`thinking_budget=0`) | $0.108 / $0.054 | $0.0018 | 12 |

Gemini is ~6x cheaper but not simply "better" -- 48/60 calls agreed with Astra,
and every one of the 12 disagreements was Gemini calling rain where Astra
called none. Eyeballing the 12: Astra's "must see literally falling water" bar
looks too strict for compressed CCTV stills (7/12 look like real rain Astra
missed), Gemini overcalled in 2/12, 3/12 genuinely ambiguous. So it's a
precision/recall tradeoff, not a clean win, and there's no ground truth to
settle it further without more work.

Gemini gotcha: defaults to a hidden "thinking" mode billed as output tokens
(1,376 thinking vs 45 visible tokens in one test call). `thinking_budget=0`
cuts this ~4.5x but (a) doesn't fully honor zero -- 4,984 thinking tokens still
leaked through across the 60-call batch -- and (b) changed at least one verdict
on identical input (No -> Medium). Treat it as a quality knob, not just cost.

Scripts, still in the repo and reusable: `scripts/storm_snapshot.py` (burst
capture during a real storm), `scripts/astra_batch.py`, `scripts/gemini_batch.py`.
Test data: `data/test_sets/20260913T085639Z/`.

## Two-frame temporal-context experiment -- paused, NOT shipped

Idea: since Gemma's binding constraint is requests/day (~10k/day against a
14k/day quota), not tokens, pass the *previous* classified frame alongside the
*current* one in the same call, prompted to classify only the current frame
using the previous one as context. No production code was changed for this --
all testing was throwaway scratch scripts calling `google-genai` directly. The
web app / annotator / watchdog were deliberately left running as-is so more
frame-pair history accumulates on disk for a bigger validation pass later.

Plumbing already supports this with zero changes needed:
`InsightsService.google_generate_with_prompt()` in `app/services/insights.py`
already takes `images: list[Path]`, and `latest_images_for_camera()` already
defaults to `limit=10` (the annotator just calls it with `limit=1` today).
Frames land ~5 min apart on disk, matching the ~5.8 min reannotate cooldown, so
"the previous classified frame" is reliably present and recent.

**Confirmed wins:** two-frame context correctly caught two false-positive
classes single-frame missed (live-tested against `gemma-3-27b-it`):
- Transient IR streak artifact at "Lê Chính Đang 2" (spiderweb/debris/glare
  read as Heavy by single-frame; two-frame correctly said No).
- Night lens-flare/fog halos at "Trần Đại Nghĩa - Kênh B" and "Mai Bá Hương"
  (dry roads, streetlight starburst flare misread as Heavy/Light by
  single-frame; two-frame correctly said No).

**Confirmed regression, unresolved:** at "Cao tốc LT-DG - Trạm thu phí Long
Phước," the lot is already flooded/streaked in *both* frames (genuinely
continuous heavy rain, confirmed against a third frame in the sequence). The
naive heuristic "no new wetness -> maybe not real rain" misfires once the road
is already saturated and can't get "wetter" -- two-frame wrongly called this
No while plain single-frame correctly still said it was raining.

**Two prompt fixes tried this session, neither clean -- don't reuse verbatim:**
- v2 ("judge current frame on its own merits first, previous only for
  disambiguation") fixed the continuing-rain regression but broke both
  confirmed wins above.
- v3 ("anchor on road wetness/sheen as the primary signal, only trust
  streaks/haze when the road is also wet") fixed the regression AND the
  fog/flare case, but still mis-called the IR streak artifact, and introduced
  a new false positive: ordinary glossy night asphalt under streetlights read
  as "wet" on an actually-dry road.

**Why it stalled:** each prompt iteration fixed the previous one's failure but
broke something else -- validating one hand-picked case at a time is too small
a loop to converge. Mirrors how the production single-frame prompt itself only
converged after several rounds of real bug reports, not one sitting of a
priori tuning.

**Next step, if resumed:** build a bigger validation set (~30-40 real
previous/current frame pairs from `data/derived/rain_history.csv` transitions,
weighted toward night/IR cameras since that's where all three failure modes
above showed up) and score prompt versions against it side by side in one
pass, instead of iterating against single hand-picked cases.
