// Schematic runway motion for one movement, driven by wall-clock seconds `t`
// relative to the movement's runway time (touchdown for arrivals, rotation for
// departures). Nothing here is a tracked position: the profiles are typical
// airliner numbers chosen so a landing takes about as long as it looks.
export const ACTIVE_WINDOW = {arrival:[-160, 95], departure:[-60, 130]};
export const AIRCRAFT_SIZES = {narrow:{length:38}, wide:{length:63}, regional:{length:27}};
const GLIDE = Math.tan(3 * Math.PI / 180);   // 3° final approach
const GROUND_Y = .6;                          // sits on the runway surface
const TOUCHDOWN = 450;                        // metres past the threshold
const APPROACH_SPEED = 72;                    // m/s (~140 kt)
const ROLLOUT_SECONDS = 35, TAXI_SPEED = 12;
const ROLL_START = -42, ROLL_ACCEL = 2;       // 0 → 84 m/s by rotation
const CLIMB_RATE = 14;                        // m/s after rotation

// Which threshold the movement uses. The schedule's own runway wins; otherwise
// the assumed runway for the kind, in the METAR wind's direction.
export function chooseRunway(flight, runways, defaults, direction) {
  const named = flight.runway && runways[String(flight.runway).toUpperCase()];
  let end = named;
  if (!end) {
    const name = defaults[flight.kind];
    const ident = Object.keys(runways).find(k => runways[k].name === name && k.startsWith(direction));
    end = ident && runways[ident];
  }
  if (!end) return null;
  const dir = end.to.clone().sub(end.from).normalize();
  return {...end, dir};
}

export function movementPose(kind, t, runway) {
  let s, altitude = 0, pitch = 0, opacity = 1;
  if (kind === 'arrival') {
    if (t < 0) {
      s = TOUCHDOWN + APPROACH_SPEED * t;
      altitude = (TOUCHDOWN - s) * GLIDE; pitch = 3;
      opacity = Math.min(1, (t - ACTIVE_WINDOW.arrival[0]) / 12);
    } else if (t < ROLLOUT_SECONDS) {
      const decel = (APPROACH_SPEED - TAXI_SPEED) / ROLLOUT_SECONDS;
      s = TOUCHDOWN + APPROACH_SPEED * t - decel * t * t / 2;
    } else {
      const rolled = TOUCHDOWN + (APPROACH_SPEED + TAXI_SPEED) / 2 * ROLLOUT_SECONDS;
      s = Math.min(runway.length - 150, rolled + TAXI_SPEED * (t - ROLLOUT_SECONDS));
      opacity = Math.max(0, Math.min(1, (ACTIVE_WINDOW.arrival[1] - t) / 20));
    }
  } else {
    if (t < ROLL_START) { s = 0; opacity = Math.min(1, (t - ACTIVE_WINDOW.departure[0]) / 8); }
    else if (t < 0) { const dt = t - ROLL_START; s = ROLL_ACCEL * dt * dt / 2; }
    else {
      const rotate = ROLL_ACCEL * ROLL_START * ROLL_START / 2, v0 = -ROLL_ACCEL * ROLL_START;
      s = rotate + v0 * t + Math.min(.2 * t, 35) * t / 2;
      altitude = CLIMB_RATE * t - CLIMB_RATE * 6 * (1 - Math.exp(-t / 6));
      pitch = 12 * Math.min(1, t / 3);
      opacity = Math.max(0, Math.min(1, (ACTIVE_WINDOW.departure[1] - t) / 15));
    }
  }
  const x = runway.from.x + runway.dir.x * s, z = runway.from.y + runway.dir.y * s;
  // Nose-up is a positive rotation about the body's lateral (Z) axis.
  return {x, y: GROUND_Y + altitude, z, s, altitude, pitch: pitch * Math.PI / 180, opacity};
}
