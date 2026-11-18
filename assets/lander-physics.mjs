export const RULES = Object.freeze({
  gravity: 20,
  thrust: 56,
  turnSpeed: 2,
  fuelRate: 9,
  maxVerticalSpeed: 26,
  maxHorizontalSpeed: 16,
  maxLandingAngle: Math.PI / 15,
  footWidth: 26,
  footY: 22,
});

export function randomPadPosition(previous, random = Math.random) {
  const min = 0.48;
  const max = 0.73;
  const sample = Math.max(0, Math.min(1, random()));
  if (!Number.isFinite(previous)) return min + sample * (max - min);
  // Sample the remaining intervals directly; no retries or near-duplicates.
  const leftEnd = Math.max(min, Math.min(max, previous - 0.04));
  const rightStart = Math.max(min, Math.min(max, previous + 0.04));
  const leftLength = leftEnd - min;
  const rightLength = max - rightStart;
  const offset = sample * (leftLength + rightLength);
  return rightLength === 0 || offset < leftLength ? min + offset : rightStart + offset - leftLength;
}

export function createWorld(width, height, bottomInset = 0, topInset = 0, padPosition = 0.73) {
  const terrainHeight = Math.max(height * 0.5, height - bottomInset);
  const padWidth = Math.min(112, Math.max(80, width * 0.15));
  const pad = { left: width * padPosition - padWidth / 2, right: width * padPosition + padWidth / 2, y: terrainHeight * 0.83 };
  const approach = pad.left - 20;
  const terrain = [
    [0, terrainHeight * 0.82], [approach * 0.25, terrainHeight * 0.76],
    [approach * 0.55, terrainHeight * 0.87], [approach * 0.8, terrainHeight * 0.79],
    [approach, terrainHeight * 0.87], [pad.left, pad.y],
    [pad.right, pad.y], [pad.right + 20, terrainHeight * 0.86], [width, terrainHeight * 0.8],
  ];
  const spawnY = Math.max(height * 0.15, Math.min(height * 0.5, topInset + 36));
  return { width, height, pad, terrain, spawnY, bottomInset, topInset, padPosition };
}

export function terrainAt(world, x) {
  for (let i = 1; i < world.terrain.length; i++) {
    const [leftX, leftY] = world.terrain[i - 1];
    const [rightX, rightY] = world.terrain[i];
    if (x <= rightX) return leftY + (rightY - leftY) * (x - leftX) / (rightX - leftX);
  }
  return world.terrain.at(-1)[1];
}

export function createFlight(world) {
  return { phase: 'ready', x: world.width * 0.2, y: world.spawnY, vx: 10, vy: 0, angle: 0, fuel: 100, thrusting: false, reason: '' };
}

export function shipPoint(ship, x, y) {
  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  return { x: ship.x + x * cos - y * sin, y: ship.y + x * sin + y * cos };
}

export function landingProblem(ship, world) {
  const feet = [-RULES.footWidth, RULES.footWidth].map(x => shipPoint(ship, x, RULES.footY));
  if (feet.some(foot => foot.x < world.pad.left || foot.x > world.pad.right)) return 'Aim for the teal landing pad.';
  if (Math.abs(ship.angle) > RULES.maxLandingAngle) return 'A little too tilted. Keep the lander within 12° of upright.';
  if (ship.vy > RULES.maxVerticalSpeed || ship.vy < 0) return 'Too fast on the way down. Touch down at 26 m/s or less.';
  if (Math.abs(ship.vx) > RULES.maxHorizontalSpeed) return 'Too much sideways drift. Stay at 16 m/s or less.';
  return '';
}

export function stepFlight(state, input, dt, world) {
  if (state.phase !== 'flying' || dt <= 0) return state;
  const ship = { ...state };
  ship.angle += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * RULES.turnSpeed * dt;
  ship.angle = Math.atan2(Math.sin(ship.angle), Math.cos(ship.angle));
  const burnTime = input.thrust ? Math.min(dt, ship.fuel / RULES.fuelRate) : 0;
  ship.thrusting = burnTime > 0;
  ship.fuel = Math.max(0, ship.fuel - RULES.fuelRate * burnTime);
  ship.vx += Math.sin(ship.angle) * RULES.thrust * burnTime;
  ship.vy += RULES.gravity * dt - Math.cos(ship.angle) * RULES.thrust * burnTime;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  if (ship.x < 22 || ship.x > world.width - 22 || ship.y < -30) {
    return { ...ship, phase: 'crashed', thrusting: false, reason: 'Out of the flight area. Small, gentle burns work best.' };
  }
  const contacts = [[0, -24], [-17, -10], [17, -10], [-26, 22], [26, 22]];
  const collision = contacts.some(([x, y]) => {
    const point = shipPoint(ship, x, y);
    return point.y >= terrainAt(world, point.x);
  });
  if (collision) {
    const reason = landingProblem(ship, world);
    if (reason) return { ...ship, phase: 'crashed', thrusting: false, reason };
    return { ...ship, phase: 'landed', y: world.pad.y - RULES.footY, vx: 0, vy: 0, angle: 0, thrusting: false };
  }
  return ship;
}
