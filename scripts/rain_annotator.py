import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.atomic_write import write_json_atomic
from app.log_setup import get_logger
from app.services.insights import InsightsService

REPO = Path(__file__).resolve().parents[1]
SAMPLE_CAMERAS_PATH = REPO / "data" / "derived" / "sample_cameras.json"
LOCATIONS_PATH = REPO / "data" / "derived" / "camera_locations.json"
OUTPUT_PATH = REPO / "data" / "derived" / "rain_sample.json"
STATE_PATH = REPO / "data" / "derived" / "annotator_state.json"

# rain_sample.json only ever holds the *current* reading per camera, because each
# write overwrites the last. This append-only log is the historical record: without
# it every past reading is lost, and questions like "when did it last rain in
# District 7" or "how did the classifier do that afternoon" are unanswerable.
HISTORY_PATH = REPO / "data" / "derived" / "rain_history.csv"
HISTORY_FIELDS = [
    "timestamp", "camera_id", "location_text", "rain", "justification", "image",
]

log = get_logger("annotator")

POLL_SECONDS = 60

# Hard ceiling on Gemma usage: the fetch sweep's speed varies wildly with the
# government site's own responsiveness (observed 2-52 cameras/min in one session),
# so image freshness alone can't be trusted to bound API volume. Derive a
# per-camera cooldown from a fixed daily budget so the cap holds even if the
# watchdog changes how many cameras are being sampled.
TARGET_DAILY_BUDGET = int(os.getenv("TARGET_DAILY_BUDGET", "10000"))  # under a 14k/day quota

# Gemma calls run concurrently because each one is ~18s of waiting on the network.
# Two workers halve the cycle (11.9 -> 6.0 min per camera) at ~9,650 calls/day, 69%
# of quota. The budget cooldown above is the backstop: it doesn't bind at today's
# latency, but if Gemma gets faster than ~17s/call it pins usage at the budget
# rather than letting throughput run away (2 workers at 12s would be 14,400/day,
# over quota). Raise workers only together with a matching budget check.
ANNOTATE_WORKERS = int(os.getenv("ANNOTATE_WORKERS", "2"))

# Ignore frames older than a few sweep laps. Matters for cameras rotated back into
# the set, which still have stale images on disk from their previous stint.
MAX_FRAME_AGE_SEC = int(os.getenv("MAX_FRAME_AGE_SEC", "900"))

# The previous frame is sent as context so a dry->wet change can be read as rain.
# It is only admissible if it is recent: "the road was dry in the earlier frame"
# means nothing if that frame is from yesterday, and a camera coming back from an
# outage is exactly the case that would otherwise invent a downpour out of a gap.
# Frames land ~5 min apart, so this tolerates jitter and a single missed sweep.
PAIR_ENABLED = os.getenv("PAIR_ENABLED", "1") == "1"
# PERCEPTION_DECISION=0 falls back to asking the model for the verdict itself, which is
# what shipped before and what measured 0/20 recall against the gauges. See decide().
PERCEPTION_DECISION = os.getenv("PERCEPTION_DECISION", "1") == "1"
PAIR_MAX_GAP_SEC = int(os.getenv("PAIR_MAX_GAP_SEC", "780"))  # 13 min

# Carry the previous JUDGMENT forward (not the previous frame) and have the model
# report how much water is lying on the road, so a change in that level can be
# read as rain arriving or stopping. Measured at QL 22 - Nguyễn Văn Bứa 1 against
# a gauge 1.3km away that recorded +3.2mm then +17.2mm in consecutive hours:
#   during the measured rain   10 rain calls in 15 frames   (was 1 without this)
#   after it stopped            1 in 21, road still soaked  (correctly quiet)
#   a known dry night           0 in 7
#
# What makes it work is NOT the road. The road saturates at "soaked" and sits
# there for two hours carrying no information; the ponchos come off within
# minutes of the rain stopping. The level change catches the onset, the daylight
# evidence carries the plateau.
#
# STATEFUL_ENABLED=0 falls back to the stateless prompt, which is unchanged.
STATEFUL_ENABLED = os.getenv("STATEFUL_ENABLED", "1") == "1"
# "the road was dry" stops meaning anything if that judgment is hours old. Text
# state ages better than a frame comparison, so this is looser than
# PAIR_MAX_GAP_SEC, but it is still bounded.
STATE_MAX_AGE_SEC = int(os.getenv("STATE_MAX_AGE_SEC", "1800"))  # 30 min

WATER_LEVELS = ["dry", "damp", "wet", "soaked", "standing water"]

ICT = timezone(timedelta(hours=7))  # Vietnam has no DST

# Time of day changes what the same visual evidence means, and getting this wrong is
# not hypothetical: a 04:54 frame of pre-dawn mist was read as a heavy downpour
# because the street was empty and visibility was poor -- both true, and both because
# it was 5am, not because of rain.
DARK_GUIDANCE = (
    "It is dark in this frame, which changes what the evidence means:\n"
    "- Poor visibility, haze, and halos or starbursts around streetlights are ordinary "
    "after dark, and especially near dawn, when humid air here often sits as mist or fog. "
    "Do NOT read murk, glare or reduced visibility as heavy rain.\n"
    "- An empty or near-empty street is normal at this hour. It is NOT evidence that rain "
    "has driven people off the road.\n"
    "- Raincoats and umbrellas are hard to make out in the dark, so not seeing them says "
    "very little either way.\n"
    "- What still counts at night: distinct streaks or dashes falling through headlight and "
    "streetlight beams, spray kicked up behind moving vehicles, standing water visibly "
    "rippling or splashing, or droplets sitting on the camera lens. Without at least one of "
    "those, answer 'No' even if the scene looks murky.\n\n"
)

DAY_GUIDANCE = (
    "It is daylight in this frame:\n"
    "- These streets are normally thick with motorbikes at this hour, so a suddenly sparse "
    "road is itself worth noticing, though on its own it is not conclusive.\n"
    "- Riders in raincoats or ponchos, pedestrians under umbrellas, and people sheltering "
    "under awnings or overpasses are the clearest signals available in daylight.\n"
    "- Overcast grey skies alone are not rain; this city is often overcast without a drop "
    "falling.\n\n"
)

# DAY_GUIDANCE calls ponchos and umbrellas "the clearest signals available in
# daylight", and then PROMPT_TAIL overrules it by requiring visible falling
# water. The result was measured against VRAIN gauges: on 20 frames where a gauge
# within 4km recorded >=5mm in the surrounding hour, production called rain on 2.
# It described what it saw -- "the road is soaked and a rider is wearing a
# poncho" -- and answered No anyway, 18 times at one camera while 14.2mm fell
# 2.7km away.
#
# This lets converging daylight evidence carry a verdict. Scored on the same
# gauge-labelled set: recall 10% -> 30%, dry precision 98% -> 95%. A stronger
# version that accepted a soaked road on its own reached 50% recall but dropped
# dry precision to 78%, because it reported aftermath as rain -- rejected.
#
# Daylight only, deliberately. Night is where glare and mist manufacture false
# positives, and an earlier night-affecting change put false Heavy readings on
# the public map. DARK_GUIDANCE frames are untouched by this.
DAY_RELAX = (
    "In daylight you do not need to see the water itself. If the road is soaked AND at least one "
    "other sign agrees -- riders in ponchos or raincoats, pedestrians under umbrellas, people "
    "sheltering, or traffic suddenly much sparser than this road normally carries -- then it is "
    "raining, and 'Light' or 'Medium' is the honest answer rather than 'No'. Those signs are what "
    "a person glancing out of a window would go on. Reserve 'No' for a daylight scene where the "
    "road is merely damp or drying and nobody is behaving as though it is raining.\n\n"
)

PROMPT_HEAD = (
    "This is one frame from a public traffic camera on a street in Ho Chi Minh City, Vietnam. "
    "Decide whether rain is falling there AT THIS MOMENT.\n\n"

    "Read the scene the way someone who lives in this city would if they glanced out a window "
    "before deciding whether to ride. Take in the whole picture at once -- how people are dressed "
    "and behaving, how the traffic is moving, the sky and the quality of the light, how the air "
    "itself looks. Do not go hunting for one giveaway object and rule on it. No single detail is "
    "reliable here; a consistent impression across many weak signals is. Where the signals "
    "disagree, or the frame is too dark, distant or blurred to read confidently, say so plainly "
    "and settle on the less dramatic reading.\n\n"

    "Local context that shapes what you are looking at:\n"
    "- These streets are dominated by motorbikes, so the riders are the most expressive thing in "
    "any frame: what they are wearing, whether they are still moving, whether they have pulled "
    "over or clustered under cover.\n"
    "- Rain here usually arrives as a sudden heavy downpour and stops just as abruptly. A soaked, "
    "puddled street under a brightening sky is an ordinary sight and does NOT mean it is raining "
    "now.\n"
    "- Wet asphalt throws back streetlights, shop signs and headlights very strongly, especially "
    "after dark. Shine, glare and reflections are the most misleading thing in these frames -- on "
    "their own they say almost nothing about whether rain is currently falling.\n"
    "- Rain lands on the camera as well as the street, so heavy weather tends to change how the "
    "entire image reads, not just what can be seen inside it.\n\n"
)

TAIL_OPEN = (
    # Anchored on visible falling water rather than on an empty street or poor
    # visibility: those are satisfied by any quiet, dark or misty hour, and reading
    # them as rain is precisely how a 5am fog frame got called a downpour.
    "Judge intensity on this city's own scale, not a generic one, and anchor it on water you "
    "can actually see falling:\n"
    "- 'Heavy': rain visibly coming down hard -- dense streaks, heavy spray thrown off vehicles, "
    "water running or pooling across the road, riders pulled over or struggling.\n"
    "- 'Medium': steady rain that the people out there have clearly committed to, with fall "
    "visible against a dark background or in the light.\n"
    "- 'Light': drizzle people put up with, which plenty do not bother covering up for.\n"
)

# Two definitions of 'No', because they are only correct for their own input.
# Single-frame has no way to know the road was dry ten minutes ago, so it can only
# rule on what is falling now. Given the previous frame, refusing to use the
# dry->wet change throws away the strongest evidence in the pair: measured on the
# labelled set, single-frame missed BOTH rain frames and two-frame without this
# bullet still missed 3 of 9, while with it 8 of 9 land (NOTES.md).
NO_BULLET_SINGLE = (
    "- 'No': nothing is falling right now -- however wet the ground is, however dark, hazy or "
    "empty the scene looks.\n\n"
)
NO_BULLET_PAIR = (
    "- 'No': nothing is falling now and nothing shows it was falling moments ago. But if the "
    "earlier frame shows a dry road and this one shows a wet one, water fell in between -- that "
    "is rain, not 'No', even if you cannot see it falling. Pick the intensity the change implies: "
    "a road that went from dry to fully soaked in five minutes means it came down hard. A road "
    "already wet in BOTH frames is not evidence of new rain -- that is the aftermath, and 'No' "
    "is right.\n\n"
)

TAIL_WARN = (
    "An empty street, poor visibility, or a murky-looking image are NOT by themselves reasons to "
    "answer Heavy. Only visible falling water justifies that.\n\n"
)

# The justification is published under the photo on the map. Readers see one
# street scene and know nothing about how many frames were compared, so wording
# like "the road is wet in both frames" describes our method and reads as a
# non-sequitur to them. Compare across the frames as much as you like -- just
# report the conclusion as a statement about the street.
PAIR_JUSTIFY_RULE = (
    "Your justification is published beneath a single photo of this street, for readers who "
    "never see the earlier frame and know nothing about how this was worked out. So write it "
    "about the street itself, describing the conditions you settled on. Do NOT mention frames, "
    "images, comparisons, or what things looked like earlier -- no 'in both frames', no 'in the "
    "first/second frame', no 'between the frames'. This is a rule about wording only: decide the "
    "verdict first, on the evidence, and then describe it without reference to how you looked.\n\n"
)

TAIL_SCHEMA = (
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence giving the overall read of the scene that decided it>"}'
)

LEVEL_RULES = (
    "Report how much water is lying on the road, on this scale:\n"
    "    dry            matte surface, no sheen\n"
    "    damp           darkened but not reflecting much\n"
    "    wet            reflecting light across most of the carriageway\n"
    "    soaked         mirror-like, water visibly covering the surface\n"
    "    standing water pooling, puddles, vehicles throwing up spray\n\n"
)

STATE_RULES = (
    "The same camera was judged {mins} minutes ago:\n"
    "    water on the road then: {level}\n"
    "    verdict then: {rain}\n"
    "{staleness}"
    "\nWhat that tells you:\n"
    "- MORE water now than then means water has been arriving in between. It is raining. Pick the "
    "intensity from how big the change is: dry to soaked in a few minutes means it came down hard.\n"
    "- LESS water now than then means the road is drying and the rain has stopped. Answer 'No' "
    "unless you can actually see water falling in this frame.\n"
    "- The SAME amount of water tells you less than either. The rain may still be falling steadily, "
    "or it may have stopped and left the road wet -- both look alike. Decide on what is visible in "
    "this frame right now: streaks in the light, spray off vehicles, ripples in standing water, "
    "riders in ponchos. Without any of that, an unchanged wet road is more likely to be the "
    "aftermath than the rain itself.\n\n"
)

STALENESS = (
    "    the road has been at that same level for {mins} minutes now, with nothing new arriving\n"
)

# The stateful path needs its own 'No', and this is the wording that was actually
# measured. It states the aftermath principle outright -- a wet road is not rain,
# because rain here stops as abruptly as it starts -- which is the distinction the
# whole design turns on. NO_BULLET_SINGLE's generic phrasing is weaker here.
NO_BULLET_STATEFUL = (
    "- 'No': no water is falling right now. A wet road on its own is not rain -- rain here stops as "
    "abruptly as it starts and leaves the street soaked behind it.\n\n"
)

WATER_SCHEMA = (
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"water": "<one of: dry, damp, wet, soaked, standing water>", '
    '"rain": "<one of: No, Light, Medium, Heavy>", '
    '"justification": "<one short sentence about the street itself, for a reader who sees only '
    'this photo -- never mention frames, comparisons, or earlier judgments>"}'
)

# ---------------------------------------------------------------------------
# Perception path: the model observes, decide() rules.
#
# Measured against VRAIN gauge labels (scripts/perception_eval.py), 36 frames:
# `falling` -- the visible-water evidence every version of this prompt has anchored
# on -- was true ZERO times, on rain frames and dry frames alike. It is not a weak
# signal here, it is an absent one: at this resolution the streaks and spray the
# tail demands are simply not in the image. That is why asking the model for a
# verdict scored 0/20 recall while its own justification said "the road is fully
# soaked and mirror-like", and why rewording that demand three ways (A/B/C) moved
# errors around instead of removing them.
#
# Water level does separate the classes: soaked-or-above appeared on 6/18 rain
# frames and 0/18 dry ones. One step down does not -- `wet` was 2/18 rain against
# 5/18 dry, so the threshold sits at soaked and no lower.
#
# Two signals measured as noise and are deliberately NOT used: water rising versus
# the previous frame fired on 1 rain frame and 2 dry ones (more often when dry --
# during steady rain consecutive frames are both soaked, so there is no rise to
# see), and wet-weather behaviour was true on 1/18 rain frames, because most of
# this network looks at expressways where no rider or pedestrian is visible at all.
# Any rule requiring behaviour as a conjunct scored 0%.
PERCEPTION_TASK = (
    "Do NOT judge whether it is raining. Report only what you can see, as three separate "
    "observations. Another system decides the weather from your three answers, so an honest "
    "observation you are unsure about is more useful than a guess dressed up as certainty.\n\n"
)

FALLING_Q = (
    "Is falling water DIRECTLY visible in this frame? That means at least one of: distinct streaks "
    "or dashes against a dark background or in headlight and streetlight beams, spray thrown up "
    "behind a moving vehicle, ripples or splashing in standing water, or droplets sitting on the "
    "camera lens. Reflections, glare, haze, poor visibility and a generally murky image are NOT "
    "falling water. Answer 'yes' or 'no'.\n\n"
)

# Three values, not two. Absence of people is not evidence of dry weather, and a
# yes/no field turns every expressway camera -- cars and trucks at a distance, no
# visible occupants -- into a standing vote for "nobody is dressed for rain".
BEHAVIOUR_Q = (
    "Are the people in this frame behaving as though it is raining? That means riders in ponchos or "
    "raincoats, pedestrians under umbrellas, people sheltering under awnings or an overpass, or "
    "riders pulled over waiting it out. If no people are visible to judge -- an empty road, or only "
    "cars and trucks whose occupants you cannot see -- answer 'none visible'. Use 'no' only when "
    "you can actually see people and none of them are dressed or acting for rain. Answer 'yes', "
    "'no', or 'none visible'.\n\n"
)

PERCEPTION_SCHEMA = (
    "Respond with STRICT JSON only, no markdown fences, no extra text, matching this schema: "
    '{"water": "<one of: dry, damp, wet, soaked, standing water>", '
    '"falling": "<one of: yes, no>", '
    '"behaviour": "<one of: yes, no, none visible>", '
    '"justification": "<one short sentence describing this street as it looks now, for a reader '
    'who sees only this photo -- describe the road and the traffic, do not state a verdict about '
    'the weather>"}'
)

TAIL_CLOSE = TAIL_WARN + TAIL_SCHEMA

PROMPT_TAIL = TAIL_OPEN + NO_BULLET_SINGLE + TAIL_CLOSE

TWO_FRAME_PRE = (
    "You are given TWO frames from the same fixed traffic camera, about five minutes apart. The "
    "FIRST is the earlier frame, context only. Classify the SECOND.\n\n"
)


def phase_for(hour: int) -> str:
    """What this hour means on these streets.

    Boundaries follow HCMC's actual day: near the equator, so sunrise is ~05:45 and
    sunset ~17:55 year-round, and the city stirs early -- 05:00 is people heading out,
    not the dead of night. Getting this wrong matters, because the dawn window is
    exactly when mist is most likely to be mistaken for rain.
    """
    if hour < 4:
        return "the middle of the night, when the roads are genuinely quiet"
    if hour < 6:
        return ("dawn -- before sunrise, but the city is already stirring and traffic is "
                "picking up. Mist, low cloud and damp haze are common at this hour")
    if hour < 9:
        return "early morning, with the sun up and traffic building toward rush hour"
    if hour < 16:
        return "the middle of the day, when traffic is normally heavy"
    if hour < 18:
        return "late afternoon, with the light starting to go"
    if hour < 22:
        return "evening, when the roads are lit but still busy"
    return "late evening, with traffic thinning out"


def decide(result: dict) -> tuple[str, str]:
    """Turn three observations into a verdict. Rule R2 from perception_eval.py.

    R2 is `falling OR water >= soaked`, which scored 33% recall at 100% dry precision
    against the gauge labels, against 0%/100% for the verdict production was asking the
    model for and 20-30%/95% for the best reworded prompt. It is the only change measured
    this round that raised recall without spending precision.

    On that sample `falling` never fired, so the rule reduces to the water threshold --
    but it stays in as a disjunct rather than being deleted. The sample held no genuine
    downpour (no frame reached 'standing water'), and spray and streaks are exactly what
    a downpour would put in the image. Keeping it can only add detections.

    Deliberately never returns 'Heavy'. Nothing measured here justifies that step, and a
    false Heavy is the specific failure that has embarrassed this map before -- an earlier
    night-side change put them on the public page. Heavy can come back when there is a
    label set with real downpours in it to calibrate against.

    Returns (verdict, justification). The justification is replaced when the water level
    carries the verdict, because the model wrote it while under instructions not to judge
    the weather, and a caption reading "the road is wet and traffic is light" under a
    "Light" badge reads as a non-sequitur to someone who sees only the photo.
    """
    water = str(result.get("water", "")).lower().strip()
    falling = str(result.get("falling", "")).lower().strip() == "yes"
    said = str(result.get("justification", "")).strip()
    level = WATER_LEVELS.index(water) if water in WATER_LEVELS else -1
    standing = WATER_LEVELS.index("standing water")
    soaked = WATER_LEVELS.index("soaked")

    if falling and level >= soaked:
        return "Medium", said or "Rain is falling on an already soaked road."
    if falling:
        return "Light", said or "Rain is visibly falling on the street."
    if level >= standing:
        return "Medium", "Water is pooling on the carriageway and vehicles are throwing up spray."
    if level >= soaked:
        return "Light", "The carriageway is soaked, with water lying across the surface."
    return "No", said


def build_prompt(
    captured_at_iso: str | None,
    two_frame: bool = False,
    prev: dict | None = None,
) -> str:
    """Assemble the prompt, telling the model what local time it is looking at.

    Without this the model has no way to tell 'deserted because of a downpour' from
    'deserted because it is 4am', and both look identical in a dark frame.

    two_frame must match what is actually sent: the pair wording talks about "the
    earlier frame", which is worse than useless if only one image goes with it.

    prev carries the previous judgment for this camera (level / rain / how long
    the level has held). When absent -- first sight of a camera, or the last
    judgment is too old to mean anything -- the prompt falls back to the
    stateless wording, byte-for-byte what it was before any of this existed.
    """
    pre = TWO_FRAME_PRE if two_frame else ""
    # Checked before STATEFUL_ENABLED: the perception path replaces the in-prompt
    # verdict entirely, so the stateful block's decision wording would only be
    # instructions for a judgment this prompt no longer asks the model to make.
    # The pair path is left alone -- PAIR_ENABLED has not fired in production for
    # the whole of the current run (170 single, 0 paired), so it is untested
    # ground and not somewhere to make a change nobody can observe.
    if PERCEPTION_DECISION and not two_frame:
        when = ""
        if captured_at_iso:
            local = datetime.fromisoformat(captured_at_iso).astimezone(ICT)
            when = (f"This frame was captured at {local.strftime('%H:%M')} local time in Ho Chi "
                    f"Minh City ({local.strftime('%A')}), which is {phase_for(local.hour)}.\n\n")
        return (PROMPT_HEAD + when + PERCEPTION_TASK + LEVEL_RULES + FALLING_Q + BEHAVIOUR_Q
                + PERCEPTION_SCHEMA)
    # The water level must be asked for even on the FIRST sight of a camera,
    # when there is no prior judgment to compare against. Gating the whole
    # stateful prompt on `prev` deadlocks it: no prior state means the stateless
    # prompt, which never asks for a level, so nothing is stored, so there is
    # never a prior state. Verified against the deployed path -- the water column
    # came back empty on all 38 frames and the chain silently degraded to B.
    if STATEFUL_ENABLED and not two_frame:
        state = ""
        if prev:
            stale = STALENESS.format(mins=prev["flat_mins"]) if prev["flat_mins"] >= 10 else ""
            state = STATE_RULES.format(mins=prev["mins"], level=prev["level"].upper(),
                                       rain=prev["rain"], staleness=stale)
        tail = LEVEL_RULES + state + TAIL_OPEN + NO_BULLET_STATEFUL + TAIL_WARN + WATER_SCHEMA
    else:
        tail = (
            TAIL_OPEN
            + (NO_BULLET_PAIR if two_frame else NO_BULLET_SINGLE)
            + TAIL_WARN
            + (PAIR_JUSTIFY_RULE if two_frame else "")
            + TAIL_SCHEMA
        )
    if not captured_at_iso:
        return pre + PROMPT_HEAD + tail

    local = datetime.fromisoformat(captured_at_iso).astimezone(ICT)
    hour = local.hour
    is_dark = hour < 6 or hour >= 18

    # Boundaries follow HCMC's actual day: near the equator, so sunrise is ~05:45 and
    # sunset ~17:55 year-round, and the city stirs early -- 05:00 is people heading out,
    # not the dead of night. Getting this wrong matters, because the dawn window is
    # exactly when mist is most likely to be mistaken for rain.
    phase = phase_for(hour)

    when = (
        f"This frame was captured at {local.strftime('%H:%M')} local time in Ho Chi Minh City "
        f"({local.strftime('%A')}), which is {phase}.\n\n"
    )
    guidance = DARK_GUIDANCE if is_dark else DAY_GUIDANCE + DAY_RELAX
    return pre + PROMPT_HEAD + when + guidance + tail


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default


def captured_at_from(image_path: Path) -> str | None:
    """Capture time of a frame, from the filename the fetcher stamps it with.

    src/fetch/check.py names files with datetime.now() on a UTC host, so the stem
    is a UTC wall-clock time; tag it as such rather than leaving it naive, so the
    map can render it in whatever timezone the viewer is in.
    """
    m = re.match(r"^(\d{8})_(\d{6})", image_path.stem)
    if not m:
        return None
    try:
        dt = datetime.strptime(f"{m.group(1)}_{m.group(2)}", "%Y%m%d_%H%M%S")
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


def append_history(rec: dict) -> None:
    write_header = not HISTORY_PATH.exists()
    try:
        with HISTORY_PATH.open("a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(HISTORY_FIELDS)
            writer.writerow([
                rec.get("updated_at", ""),
                rec.get("camera_id", ""),
                rec.get("location_text", ""),
                rec.get("rain", ""),
                rec.get("justification", ""),
                Path(rec.get("image_url", "")).name,
            ])
    except Exception as e:  # history is useful, but never worth killing the loop over
        log.warning("could not append history for %s: %s", rec.get("camera_id"), e)


def usable_previous(svc: InsightsService, cam_id: str, image_path: Path) -> Path | None:
    """The frame before image_path, if it is recent enough to compare against."""
    if not PAIR_ENABLED:
        return None
    recent = svc.latest_images_for_camera(cam_id, limit=2)
    if len(recent) < 2 or recent[-1] != image_path:
        return None
    prev = recent[-2]
    now, before = captured_at_from(image_path), captured_at_from(prev)
    if not (now and before):
        return None
    gap = (datetime.fromisoformat(now) - datetime.fromisoformat(before)).total_seconds()
    return prev if 0 < gap <= PAIR_MAX_GAP_SEC else None


def prior_state(rec: dict, captured_at_iso: str | None) -> dict | None:
    """Previous judgment for this camera, if recent enough to inform this frame.

    Returns None when there is no stored level, when the model last failed to
    give one, or when the judgment has aged past STATE_MAX_AGE_SEC -- a camera
    coming back from an outage must not be told the road "was dry" three hours
    ago and read that as a downpour since.
    """
    if not (STATEFUL_ENABLED and captured_at_iso):
        return None
    level = rec.get("water")
    if level not in WATER_LEVELS:
        return None
    prev_seen = rec.get("captured_at")
    if not prev_seen:
        return None
    try:
        now = datetime.fromisoformat(captured_at_iso)
        then = datetime.fromisoformat(prev_seen)
        since = datetime.fromisoformat(rec.get("water_since") or prev_seen)
    except ValueError:
        return None
    age = (now - then).total_seconds()
    if not 0 < age <= STATE_MAX_AGE_SEC:
        return None
    return {
        "level": level,
        "rain": rec.get("rain", "No"),
        "mins": max(1, round(age / 60)),
        "flat_mins": max(0, round((now - since).total_seconds() / 60)),
    }


def annotate(
    svc: InsightsService,
    image_path: Path,
    captured_at_iso: str | None = None,
    prev_path: Path | None = None,
    prev: dict | None = None,
) -> dict:
    images = [prev_path, image_path] if prev_path else [image_path]
    text = svc.google_generate_with_prompt(
        images=images,
        prompt=build_prompt(captured_at_iso, two_frame=prev_path is not None, prev=prev),
    )
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    return json.loads(cleaned)


def main():
    svc = InsightsService()
    state = load_json(STATE_PATH, {})
    records = {r["camera_id"]: r for r in load_json(OUTPUT_PATH, [])}
    display_names = {r["camera_id"]: r.get("display_name", "") for r in load_json(LOCATIONS_PATH, [])}

    cameras = load_json(SAMPLE_CAMERAS_PATH, [])
    startup_interval = 86400 * max(len(cameras), 1) / TARGET_DAILY_BUDGET
    log.info(
        "watching %d sample cameras, %d concurrent worker(s), polling every %ds, "
        "per-camera cooldown %.0fs (budget %d/day), history -> %s",
        len(cameras), ANNOTATE_WORKERS, POLL_SECONDS, startup_interval,
        TARGET_DAILY_BUDGET, HISTORY_PATH.relative_to(REPO),
    )

    while True:
        # reload each pass so a watchdog swapping cameras in/out takes effect without a restart
        cameras = load_json(SAMPLE_CAMERAS_PATH, [])
        if not cameras:
            time.sleep(POLL_SECONDS)
            continue
        min_reannotate_interval_sec = 86400 * len(cameras) / TARGET_DAILY_BUDGET

        current_ids = {c["camera_id"] for c in cameras}
        dropped = [cid for cid in list(records) if cid not in current_ids]
        for cid in dropped:
            records.pop(cid, None)
            state.pop(cid, None)
        if dropped:
            log.info("pruned %d camera(s) no longer in the sample set: %s", len(dropped), dropped)
            write_json_atomic(OUTPUT_PATH, list(records.values()))
            write_json_atomic(STATE_PATH, state)

        # Phase 1 -- pick what's due, single-threaded. Selecting up front means two
        # workers can never be handed the same camera, and the cooldown is evaluated
        # exactly once per camera per pass.
        due = []
        for cam in cameras:
            cam_id = cam["camera_id"]
            latest = svc.latest_images_for_camera(cam_id, limit=1)
            if not latest:
                continue
            img_path = latest[0]
            if state.get(cam_id) == str(img_path):
                continue  # no new frame since last check

            # A camera rotated back into the set still has old frames on disk, and its
            # state entry was pruned when it left -- so without this it would be graded
            # on a days-old image and the map would show that as current.
            captured = captured_at_from(img_path)
            if captured:
                frame_age = (datetime.now(timezone.utc) - datetime.fromisoformat(captured)).total_seconds()
                if frame_age > MAX_FRAME_AGE_SEC:
                    continue

            # lat/lon must be carried onto the record: the map drops any row without
            # them, so a newly-added camera would otherwise never draw a pin.
            rec = records.get(cam_id, {
                "camera_id": cam_id,
                "title": cam.get("title", ""),
                "district": cam.get("district", ""),
            })
            if rec.get("lat") is None:
                rec["lat"], rec["lon"] = cam.get("lat"), cam.get("lon")
                rec.setdefault("approx", False)

            last_updated = rec.get("updated_at")
            if last_updated:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(last_updated)).total_seconds()
                if age < min_reannotate_interval_sec:
                    continue  # rate-limit Gemma usage; state stays unset so we retry once cooldown passes

            due.append((cam, rec, img_path, usable_previous(svc, cam_id, img_path)))

        # Phase 2 -- run the Gemma calls concurrently. Workers are pure: they only do
        # the network call and hand back a result. All mutation of records/state and
        # every file write stays on this thread, so none of it needs locking.
        def call_gemma(item):
            cam, rec, img_path, prev_path = item
            started = time.monotonic()
            try:
                captured = captured_at_from(img_path)
                result = annotate(svc, img_path, captured, prev_path,
                                  prev=prior_state(rec, captured))
                return item, result, time.monotonic() - started, None
            except Exception as e:
                return item, None, time.monotonic() - started, e

        changed = 0
        if due:
            with ThreadPoolExecutor(max_workers=ANNOTATE_WORKERS) as pool:
                for (cam, rec, img_path, prev_path), result, elapsed, err in pool.map(call_gemma, due):
                    cam_id = cam["camera_id"]
                    if err is not None:
                        log.warning("[%s] annotate failed after %.1fs: %s", cam_id, elapsed, err)
                        continue

                    rec["location_text"] = display_names.get(cam_id) or cam.get("display_name") or rec.get("location_text", "")
                    if PERCEPTION_DECISION and prev_path is None:
                        verdict, justification = decide(result)
                    else:
                        verdict = result.get("rain", rec.get("rain", "No"))
                        justification = result.get("justification", "")
                    rec["rain"] = verdict
                    # Track the water level and when it last changed, so the next
                    # pass can tell "still soaked" from "soaked for 40 minutes".
                    # A missing or bogus level clears the state rather than
                    # freezing a stale one: prior_state() then returns None and
                    # this camera falls back to the stateless prompt.
                    level = str(result.get("water", "")).lower().strip()
                    if level in WATER_LEVELS:
                        if level != rec.get("water"):
                            rec["water_since"] = captured_at_from(img_path)
                        rec["water"] = level
                    else:
                        rec.pop("water", None)
                        rec.pop("water_since", None)
                    rec["justification"] = justification
                    rec["image_url"] = f"/media/{img_path.as_posix().lstrip('./')}"
                    rec["captured_at"] = captured_at_from(img_path)  # when the frame was taken
                    rec["updated_at"] = datetime.now(timezone.utc).isoformat()  # when Gemma read it
                    records[cam_id] = rec
                    state[cam_id] = str(img_path)
                    changed += 1
                    log.info(
                        "[%s] %s -> %s (%s%s, %.1fs) %s",
                        cam_id, rec["location_text"] or cam.get("district", ""), rec["rain"],
                        img_path.name, f" +{prev_path.name}" if prev_path else " single",
                        elapsed, rec["justification"],
                    )

                    append_history(rec)
                    write_json_atomic(OUTPUT_PATH, list(records.values()))
                    write_json_atomic(STATE_PATH, state)

        if changed:
            log.info("pass complete: %d camera(s) re-annotated", changed)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
