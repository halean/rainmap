# Rain lab

The rain map reads rain off traffic cameras. This lab is the set of logs, hand labels and scripts
for asking how well it does that, and whether anything else (bigger models, radar, gauges,
HYMETNET's rain maps, neighbouring cameras) makes it better. Every question so far was answered by
the same recipe: label frames by hand where the readers disagree, then score each reader on those
frames, training only on earlier batches.

State as of 6 Oct 2026. Times are UTC unless marked VN (UTC+7).

## What is collected

| Log | Written by | Cadence | Since | Notes |
|---|---|---|---|---|
| `data/derived/rain_history.csv` | `rain_annotator.py` | every reading (~6,500/day) | 12 Sep | what the map published |
| `data/derived/rain_shadow.csv` | `rain_annotator.py` + `app/services/rain_shadow.py` | every reading | 1 Oct 19:37 | Gemma's raw verdict and its water / falling / behaviour readings, the embedding score, the map's final verdict (`final`, after the veto) |
| `data/derived/embedding_cache/gemini-embedding-2.shadow.jsonl` | shadow mode | every reading | 1 Oct | the frame's 3072-d embedding (base64 float32), keyed by image path; what the hand-label classifier runs on |
| `data/derived/rain_decider.csv` | `rain_annotator.py` + shadow mode | every reading | 6 Oct 12:48 | Gemma's verdict, what the old path (Gemma + veto) would have published, the hand-label classifier's score, and what was published |
| `data/derived/radar_cameras.csv`, `radar_archive/` | `radar_poller.py` | 10 min | 1 Oct 22:30 | Nhà Bè radar (dBZ, column max) at every camera; `clean_*` columns have clutter removed |
| `data/derived/vrain_history.csv` | `vrain_poller.py` | 10 min | 13 Sep | VRAIN gauges; hourly reports, so an hour late |
| `data/derived/lightning_vn_*_history.csv` | `hymetnet_poller.py` | 3 min | 24 Sep | HYMETNET lightning |
| `data/derived/hymetnet_rain_cameras.csv`, `hymetnet_rain/` | `hymetnet_rain_poller.py` | page every 5 min (`HYMETNET_RAIN_POLL_SEC=300`), frames when the run changes | 5 Oct 22:43 | HYMETNET's hourly rain map at every camera: 6 measured hours and the +1..+6 h nowcast, per run |
| `data/derived/hymetnet_rain_measured.csv` | one-off backfill | hourly | 4 Oct 00:00 to 5 Oct ~21:00 | measured hours only; earlier hours were already gone |
| `data/derived/vne_forecast_points.csv`, `vne_forecast/` | `vne_forecast_logger.py` | 15 min | 5 Oct 13:37 | VnExpress's copy of HYMETNET's district-level heavy-rain points |
| `weathernext3/runs/<init>.csv` | `weathernext3/poller.py` (BigQuery) | new run hourly, polled every 20 min | runs from 1 Oct 00:00 (backfilled) | Google DeepMind WeatherNext 3 ensemble rain (mm/h, p10-p90 + mean; IMERG-calibrated; experimental) on the 0.1 deg grid over HCMC, 1-48 h ahead; runs appear ~7.5 h late; ~65-120 MB billed per run, free tier |
| `data/flood_watch/`, `flood_reads.csv`, `flood_events.csv` | `flood_watch.py` | 68 cameras, one every 10 s; every 60 s under watch | 1 Oct | see `data/metadata/flood_cameras.json` for why each camera is there |

Two of these can never be recovered if missed:
- **HYMETNET forecasts.** Each hourly image (`COM_<valid UTC>_QPEJPA.png`) is overwritten by every
  newer run and finally by the measured estimate. Only the measured version stays online, for
  about 2 days. The poller is the only record of past forecasts.
- **Camera frames.** The city's camera site keeps no history. A camera not in the 40-camera sample
  or the flood-watch list has no frames on disk.

## Hand labels

`data/test_sets/20261003_rain7d/`, versioned in git.

- `hand_labels/labels/fNNN.json`: one label per frame: `raining`, `wet_not_raining`, `dry` or
  `cannot_tell`, with an optional note.
- `hand_labels_key.json`: what each `fNNN` is: image path, batch, the group it was drawn from, and
  the readers' answers at the time.
- `hand_labels.csv`: the same in one table (batches 1-3 only).
- `hand_labels_embeddings.jsonl`: embeddings for batch 1; later batches use the shadow cache.

The labels point at frames in `data/raw/`, which is not in git (12 GB).

| Batch | Frames | Days | Drawn from |
|---|---|---|---|
| 1 | 75 | 18-30 Sep | frames where the Opus and Sonnet judges disagreed, + 12 controls where all judges agreed |
| 2 | 150 | 1-3 Oct | Gemma vs embedding disagreements (rain vs < 0, no vs > 0.3, borderline), + 30 where both said rain |
| 3 | 50 | 1-3 Oct | both said dry, in hours a gauge within 4 km measured >= 1 mm |
| 4 | 50 | 4-6 Oct | map vs classifier disagreements; radar echo but both dry; both rain but no echo |
| 5 | 50 | 4-6 Oct | camera dry but >= 40% of neighbours raining; both rain; map vs classifier |
| 6 | 50 | 4-6 Oct | radar echo + map dry; map rain + no echo; map rain + echo; classifier-only rain |
| 7 | 50 | 5-6 Oct | old path rain / classifier dry and the reverse; both rain; both dry, neighbours raining |
| 8 | 50 | 3-6 Oct | both rain; classifier rain / old path dry and the reverse; Gemma rain vetoed; both dry, neighbours raining |
| 9 | 50 | 7 Oct storm | the luna trial: luna rain blocked by the second-reader rule; luna rain after the storm; old path rain / luna not; classifier-only rain; all dry at the storm's peak; all rain |

Every batch over-samples hard frames on purpose, so a score on a batch is accuracy on hard cases,
not on an ordinary hour. Frames from cameras on the watchdog's `PERMANENT_BLACKLIST` are left out of
training and tests (`hand_label_eval.load()`).

**Labelling more.** The page is a claude.ai artifact,
https://claude.ai/artifact/F87tfGDaEfa5mjuaEoG1UW. Labels save to its database collection `labels`,
read back with the ArtifactData tool into `hand_labels/labels/`. A batch is drawn by a short script
(see the earlier batches' `group` field for the selections), copied into the page's `frames/`, and
appended to `hand_labels_items.json` and `hand_labels_key.json`. One page version holds at most 511
files and one publish at most 255 changes, so labelled batches are taken off the page as new ones go on.

## Evaluation scripts

| Script | Answers | Run |
|---|---|---|
| `scripts/hand_label_eval.py` | how Gemma, the map and the embedding scores do on the labels; trains the hand-label classifier (logistic regression on embedding + time of day, 5-fold by camera) | `.venv/bin/python scripts/hand_label_eval.py` |
| `scripts/hand_label_fusion.py` | trains on every earlier batch, tests on the newest, adding inputs one at a time: embedding, Gemma's readings, nearby cameras, radar | `.venv/bin/python scripts/hand_label_fusion.py [--test-batch N]` |
| `scripts/hand_label_shadow.py` | scores every frame since a date with the hand-label classifier, offline, against the gauges and the map | `.venv/bin/python scripts/hand_label_shadow.py [--since ...]` |
| `scripts/nowcast_eval.py` | HYMETNET's nowcast at each lead, against persistence and the measured map, with the cameras as truth | `.venv/bin/python scripts/nowcast_eval.py` |
| `scripts/judge_pilot.py` | stronger models (Gemini, Claude) as labellers, through the batch APIs | `submit` / `collect` / `report` |
| `scripts/shadow_report.py`, `fusion_train.py`, `gauge_eval.py` | the earlier, gauge-labelled evaluations | see each docstring |

## Findings so far

These are small samples (14-20 rain frames per test batch). Treat differences of a few points as noise.

**The map today (Gemma + embedding veto).** On 1-3 Oct, reweighted from the labelled groups to all
frames: catches about 68% of rain and leaves 99.6% of not-raining frames blank, about 84% on a 50/50
mix. The misses sit where Gemma and the embedding disagree, mostly at night. Of 50 frames where
both said dry during gauge rain, none was raining. On hard frames it is right on about 92% by day and
70% at night; at night the veto does most of the work, removing false pins and some real rain.

**Stronger models as judges.** Opus 5.5 over-calls rain and Sonnet 5.5 under-calls it. On the frames
where they split, the hand labels sided 30 / 29. No single model is a reliable referee.

**Embedding classifier trained on hand labels.** AUC 0.84 (5-fold by camera) against 0.76 for the
gauge-trained shadow model, which learned "wet road", not "rain falling". On the new days 4-6 Oct, it
matches the map at the same number of false pins.

**When two readers agree** (Gemma and the classifier both say rain), it was rain 14 of 15 times.
When only one says rain, it is mostly a wet road.

**Radar (Nhà Bè).** A strong echo with dry cameras was never rain at the camera (0 of 25). No echo is
a good check on a single reader's rain call (1 of 14 was rain), but not on two agreeing readers (6 of 10).
As a fusion input it helped one test batch and hurt another.

**Gauges.** An hour late. Rain in the last two completed hours adds nothing to the fusion: of 43
frames with no gauge rain in the 2 h before, 19 were raining (storms just starting).

**Nearby cameras.** +5 points pooled over batches 4-6 (77% against 72%), but a frame has a median of
3 neighbouring cameras, and one camera wrong in all its readings flips about 10% of calls. Not used
unless rebuilt as one vote per camera, a minimum of 3 cameras, and only tipping close calls.

**HYMETNET measured rain** (radar + gauges, Japan Meteorological Agency method via JICA). Good for
the hour it covers (AUC about 0.8-0.88 against the cameras), but published about 45 min after the hour;
the latest hour available live scores 0.49.

**HYMETNET nowcast.** At +1 h it equals persistence (CSI 26% against 29%); from +2 h it has no skill.
Because runs appear about 45 min late, the frame covering "now" is usually the +2 h one. Its
heavy-rain points sit where it was raining at issue time (56-83%), not where it rains later.

**Pooled newest-batch tests** (batches 4-6, 144 frames, 49 raining):

| Reader | Agrees with hand labels | Rain caught | Pins that were rain |
|---|---|---|---|
| map (Gemma + veto) | 65% | 34/49 | 34/70 |
| embedding classifier | 71% | 37/49 | 37/67 |
| embedding + Gemma | 72-73% | 32-36/49 | |
| + nearby cameras | 77% | 38/49 | 38/60 |
| + radar | 74-75% | 30-37/49 | |

**gpt-6-luna as a reader** (`scripts/hand_label_llm.py`, flex tier). Zero-shot it agreed with the labels on
75% of 485 frames, few-shot (24 examples, 8x the tokens) 77%: the examples are not worth it. Alone it
over-calls rain at night; published only when Gemma or the classifier also sees rain it is the best reader
so far. Batch 9 (7 Oct storm, 49 frames, 11 raining):

| Reader | Agrees | Rain caught | Pins that were rain |
|---|---|---|---|
| published (luna + a second reader) | 42/49 | 7/11 | 7/10 |
| old path (Gemma + veto) | 36/49 | 7/11 | 7/16 |
| classifier | 33/49 | 8/11 | 8/21 |
| luna alone | 29/49 | 8/11 | 8/25 |

All 12 luna rain calls the rule blocked were wet or dry roads; where the old path said rain and luna did not,
luna was right 8 of 10; classifier-only rain was wet road 6 of 6. Light rain just after a storm is still
read badly by everyone (3 of 7 of luna's post-storm calls were rain).

**WeatherNext 3** (`weathernext3/`, Google DeepMind's ensemble through BigQuery). Runs from two days out put
the 7 Oct storm's peak at 17-19h; the cameras saw it arrive at 17h and peak at 19h. Over 1-7 Oct its
day-ahead city rain picks out rainy hours with AUC 0.77, no better than the average rain for that hour of
day (0.78): so far it knows that evening storms are likely, not when or where. Score it per area after more storms.

**Conclusion.** In this city the cameras are the only source that says whether it is raining on a
street right now. Everything else is late (gauges, the measured map), coarse, or sees rain aloft (radar).

## The live rain call (since 6 Oct 2026, 12:48 UTC)

**Since 6 Oct 2026, 18:56 UTC: gpt-6-luna decides**, kept after batch 9 (`RAIN_DECIDER=luna`, the
default now; `app/services/rain_luna.py`). Zero-shot, flex tier, the same prompt and previous-frame rule
as scored in `scripts/hand_label_llm.py` (75% on 485 labelled frames, 80% on batch 8). The call runs
beside Gemma's, so a reading takes no longer (17.5 s median, against 17.9 s before). A flex refusal is
retried on the standard tier; a frame luna cannot answer within 40 s, or answers cannot_tell, falls to the
classifier described below, then the old path. From 19:10 UTC luna's rain is published only when Gemma or
the classifier (score > 0) also sees rain: alone it pinned a dry, clear road (Quốc Lộ 22 - Võ Văn Điều,
01:55 ICT, Gemma No, classifier -16); on the labels the second reader cuts false pins 45 -> 34 and misses
2 more of 137 rain frames. Rain keeps Gemma's grade when Gemma also saw rain, else
luna's (light / moderate / heavy -> Light / Medium / Heavy). `rain_decider.csv` logs luna's answer,
tier and time beside the classifier score and the old path; the log before the trial is
`rain_decider.20261006T185642.csv`, its first 13 minutes (luna alone) `rain_decider.20261006T190953.csv`;
the log now also keeps luna's confidence and one-line evidence. About $1 a day. Back to the classifier: restart the annotator with
`RAIN_DECIDER=classifier`.

Before the trial:

The hand-label classifier makes the call (`RAIN_DECIDER=classifier`, the default;
`app/services/rain_shadow.py`): rain iff its score > 0. Gemma still grades the rain (Light / Medium)
and writes the caption. When the classifier says rain and Gemma did not, the pin is Light with a plain
caption; when it says dry, the pin is No with Gemma's description. A frame it cannot score falls back
to the old path (Gemma + veto). On batches 4-6, each scored by a model trained only on earlier
batches, this caught 37 of 49 rain frames with 30 false pins, against 34 and 36 for Gemma + veto.

- Model: `data/derived/hand_label_model.npz`, written by `scripts/hand_label_eval.py --save` from all
  hand labels (558 usable, 185 raining, batches 1-9). Not in git; rebuilt from the committed labels.
  Retrain after each labelled batch; the running annotator picks up the new file within a minute
  (`hand-label model reloaded` in `logs/rain_shadow.log`), and keeps the old model if the file is broken.
- Comparison: `data/derived/rain_decider.csv` logs the old path's verdict beside every published one.
- Switch back: restart the annotator with `RAIN_DECIDER=gemma`.

## Open questions

- Light rain in the hour after a storm: no reader gets it reliably.
- Does a narrow radar rule (no echo cancels a single reader's rain call) keep its precision without
  losing rain?
- How does the nowcast do in a real storm (rerun `nowcast_eval.py`)?
- Copy the labelled frames (about 40 MB) into the test set, so the labels survive `data/raw/` being pruned.

## Running it

- Settings that live only in a process's launch environment (check `/proc/<pid>/environ` before a
  restart): `flood_watch.py` with `FLOOD_DAILY_READ_CAP=4000` (storm day, 6 Oct; default 1500),
  `hymetnet_rain_poller.py` with `HYMETNET_RAIN_POLL_SEC=300`. `weathernext3/poller.py` runs with defaults and stops itself if a query bills over 1 GB (`logs/weathernext.log`). The annotator runs with defaults
  (`RAIN_DECIDER=classifier`).
- Restart a poller by finding its PID in one command
  (`ps -eo pid,args | grep "[.]venv/bin/python -u scripts/<name>.py" | grep -v "bash -c"`) and killing
  it in another; then `setsid nohup .venv/bin/python -u scripts/<name>.py >/dev/null 2>&1 &` from the
  repo root.
- New requests to outside sites (the camera site, HYMETNET, VnExpress) are agreed with the owner first.
