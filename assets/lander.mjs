import { RULES, createWorld, createFlight, stepFlight, terrainAt, randomPadPosition } from './lander-physics.mjs';

const canvas = document.querySelector('#flight');
const context = canvas.getContext('2d');
const overlay = document.querySelector('#overlay');
const successAvatar = document.querySelector('#success-avatar');
const title = document.querySelector('#message-title');
const message = document.querySelector('#message-body');
const launch = document.querySelector('#launch');
const pause = document.querySelector('#pause');
const restart = document.querySelector('#restart');
const game = document.querySelector('#game');
const fullscreen = document.querySelector('#fullscreen');
const status = document.querySelector('#game-status');
const buttons = [...document.querySelectorAll('[data-action]')];
const instruments = Object.fromEntries(['fuel', 'descent', 'drift', 'tilt'].map(id => [id, document.getElementById(id)]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const pilot = new Image();
const keys = new Set();
const pointers = new Map();
const keyActions = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'thrust', KeyW: 'thrust', Space: 'thrust' };
let world;
let ship;
let ready = false;
let frame = 0;
let lastTime = 0;
let accumulator = 0;
let hudTime = 0;
let viewWidth = 0;
let viewHeight = 0;
let crashEffect = null;
const crashDuration = 1000;
const wreckParts = [
  [[-14, -12], [0, -24], [10, -15], [-2, -8]],
  [[-17, -10], [-3, -8], [-5, 9], [-14, 12]],
  [[4, -10], [17, -10], [14, 12], [4, 8]],
  [[-12, 7], [13, 7], [9, 14], [-9, 14]],
  [[-12, 5], [-20, 22], [-26, 22]],
  [[12, 5], [20, 22], [26, 22]],
];

function inputState() {
  const held = new Set([...keys].map(key => keyActions[key]).concat([...pointers.values()]));
  return { left: held.has('left'), right: held.has('right'), thrust: held.has('thrust') };
}

function syncHeld() {
  const input = inputState();
  for (const button of buttons) {
    const held = input[button.dataset.action];
    button.classList.toggle('is-held', held);
    button.setAttribute('aria-pressed', String(held));
  }
}

function clearInput() {
  keys.clear();
  pointers.clear();
  syncHeld();
  if (ship) ship.thrusting = false;
}

function drawWreck() {
  const t = (crashEffect?.elapsed ?? crashDuration) / 1000;
  const originX = Math.max(28, Math.min(world.width - 28, ship.x));
  const originY = Math.max(28, Math.min(world.height - 28, ship.y));
  for (const [i, points] of wreckParts.entries()) {
    const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    const direction = i % 2 ? 1 : -1;
    const x = Math.max(6, Math.min(world.width - 6, originX + cx + (direction * (38 + i * 7) + ship.vx * 0.12) * t));
    const angle = ship.angle + direction * (2 + i * 0.35) * t;
    const local = points.map(([px, py]) => [px - cx, py - cy]);
    const bottom = Math.max(...local.map(([px, py]) => px * Math.sin(angle) + py * Math.cos(angle)));
    const y = Math.min(originY + cy - (48 - i * 4) * t + 110 * t * t, terrainAt(world, x) - bottom);
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();
    local.forEach(([px, py], index) => index ? context.lineTo(px, py) : context.moveTo(px, py));
    if (i < 4) {
      context.closePath();
      context.fillStyle = i % 2 ? '#8aaabb' : '#c6dce8';
      context.fill();
    }
    context.strokeStyle = '#f4f7fa';
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  }
  // The robot survives in its little cockpit, even when the hull doesn't.
  const pilotY = Math.min(originY - 5 + 80 * t * t, terrainAt(world, originX) - 14);
  context.fillStyle = '#102d46';
  context.beginPath(); context.arc(originX, pilotY, 14, 0, Math.PI * 2); context.fill();
  if (pilot.complete && pilot.naturalWidth) context.drawImage(pilot, originX - 12, pilotY - 12, 24, 24);
  context.strokeStyle = '#26bfbe';
  context.lineWidth = 1.5;
  context.stroke();
  if (t < 0.45) {
    context.save();
    context.globalAlpha = 1 - t / 0.45;
    context.fillStyle = '#ffbf75';
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      context.beginPath();
      context.arc(originX + Math.cos(angle) * t * 85, originY + Math.sin(angle) * t * 65, 1.8, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function draw() {
  if (!world || !context) return;
  const { width, height, pad, terrain } = world;
  const ratio = canvas.width / width;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#091e31';
  context.fillRect(0, 0, width, height);
  for (let i = 0; i < 52; i++) {
    const x = ((i * 137.508) % 997) / 997 * width;
    const y = ((i * 67.713 + 31) % 431) / 431 * height * 0.68;
    context.fillStyle = i % 4 ? '#94b5ca' : '#f4f7fa';
    context.beginPath();
    context.arc(x, y, i % 4 ? 0.7 : 1.2, 0, Math.PI * 2);
    context.fill();
  }
  // A little home in the distance. No parallax or background animation.
  context.fillStyle = '#26bfbe';
  context.beginPath();
  context.arc(width * 0.88, height * 0.14, 17, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#2f6388';
  context.beginPath();
  context.ellipse(width * 0.875, height * 0.135, 8, 14, 0.6, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.moveTo(...terrain[0]);
  for (const point of terrain.slice(1)) context.lineTo(...point);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = '#1d3c52';
  context.fill();
  context.strokeStyle = '#8aaabb';
  context.lineWidth = 1.5;
  context.stroke();
  context.strokeStyle = '#26bfbe';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(pad.left, pad.y);
  context.lineTo(pad.right, pad.y);
  context.stroke();
  context.strokeStyle = '#c6dce8';
  context.lineWidth = 1.5;
  for (const x of [pad.left, pad.right]) {
    context.beginPath();
    context.moveTo(x, pad.y);
    context.lineTo(x, pad.y - 17);
    context.lineTo(x + 8, pad.y - 13);
    context.stroke();
  }
  context.font = '12px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillStyle = '#f4f7fa';
  context.fillText('LAND HERE', (pad.left + pad.right) / 2, pad.y + 24);

  if (ship.phase === 'crashed') {
    drawWreck();
    return;
  }
  context.save();
  context.translate(ship.x, ship.y);
  context.rotate(ship.angle);
  if (ship.thrusting && ship.phase === 'flying') {
    context.beginPath();
    context.moveTo(-8, 12);
    context.lineTo(0, reducedMotion.matches ? 34 : 33 + Math.sin(performance.now() / 45) * 5);
    context.lineTo(8, 12);
    context.fillStyle = '#ffbf75';
    context.fill();
  }
  context.strokeStyle = '#f4f7fa';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-12, 5); context.lineTo(-20, 22); context.lineTo(-26, 22);
  context.moveTo(12, 5); context.lineTo(20, 22); context.lineTo(26, 22);
  context.stroke();
  context.beginPath();
  context.moveTo(0, -24); context.lineTo(17, -10); context.lineTo(14, 12);
  context.lineTo(-14, 12); context.lineTo(-17, -10); context.closePath();
  context.fillStyle = '#c6dce8';
  context.fill();
  context.stroke();
  context.fillStyle = '#102d46';
  context.beginPath(); context.arc(0, -5, 14, 0, Math.PI * 2); context.fill();
  if (pilot.complete && pilot.naturalWidth) context.drawImage(pilot, -12, -17, 24, 24);
  context.strokeStyle = '#26bfbe';
  context.lineWidth = 1.5;
  context.beginPath(); context.arc(0, -5, 14, 0, Math.PI * 2); context.stroke();
  context.restore();
}

function updateHud() {
  instruments.fuel.textContent = `${Math.ceil(ship.fuel)}%`;
  instruments.descent.textContent = `${Math.max(0, ship.vy).toFixed(0)} m/s`;
  instruments.drift.textContent = `${Math.abs(ship.vx).toFixed(0)} m/s`;
  instruments.tilt.textContent = `${Math.abs(ship.angle * 180 / Math.PI).toFixed(0)}°`;
}

function publish() {
  const flying = ship.phase === 'flying';
  const paused = ship.phase === 'paused';
  overlay.hidden = flying || Boolean(crashEffect && crashEffect.elapsed < crashDuration);
  successAvatar.hidden = !['ready', 'landed', 'paused'].includes(ship.phase);
  pause.disabled = !flying && !paused;
  pause.textContent = paused ? 'Resume' : 'Pause';
  restart.disabled = !ready;
  for (const button of buttons) button.disabled = !flying;
  const messages = {
    ready: ['Ready, little explorer?', 'Your robot is in the cockpit. Reach the teal pad, slow down, and land upright.', 'Launch'],
    paused: ['A little breathing space.', 'Your flight is paused. Resume whenever you’re ready.', 'Resume flight'],
    landed: ['One small step for a robot.', 'Soft touchdown. Nicely done, explorer.', 'Fly again'],
    crashed: ['A slightly harder landing.', ship.reason, 'Try again'],
  };
  if (messages[ship.phase]) {
    [title.textContent, message.textContent, launch.textContent] = messages[ship.phase];
    launch.disabled = !ready;
    status.textContent = `${title.textContent} ${message.textContent}`;
  } else {
    status.textContent = 'Flying. Aim for the teal pad. P pauses the flight.';
  }
  updateHud();
  draw();
}

function stopLoop() {
  cancelAnimationFrame(frame);
  frame = 0;
  lastTime = 0;
  accumulator = 0;
  crashEffect = null;
  clearInput();
}

function settleCrash(focus = true) {
  cancelAnimationFrame(frame);
  frame = 0;
  if (crashEffect) crashEffect.elapsed = crashDuration;
  publish();
  if (focus && !document.hidden) launch.focus({ preventScroll: true });
}

function animateCrash(time) {
  frame = 0;
  if (!crashEffect || ship.phase !== 'crashed') return;
  crashEffect.elapsed = Math.min(crashDuration, time - crashEffect.startedAt);
  draw();
  if (crashEffect.elapsed < crashDuration && !document.hidden && !reducedMotion.matches) {
    frame = requestAnimationFrame(animateCrash);
  } else settleCrash();
}

function finish() {
  stopLoop();
  if (ship.phase === 'crashed' && !reducedMotion.matches && !document.hidden) {
    crashEffect = { startedAt: performance.now(), elapsed: 0 };
    publish();
    frame = requestAnimationFrame(animateCrash);
  } else {
    publish();
    launch.focus({ preventScroll: true });
  }
}

function tick(time) {
  frame = 0;
  if (ship.phase !== 'flying') return;
  if (lastTime && time - lastTime > 250) {
    pauseFlight();
    return;
  }
  accumulator += lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  const input = inputState();
  while (accumulator >= 1 / 120 && ship.phase === 'flying') {
    ship = stepFlight(ship, input, 1 / 120, world);
    accumulator -= 1 / 120;
  }
  if (ship.phase !== 'flying') {
    finish();
    return;
  }
  draw();
  if (time - hudTime > 100) { updateHud(); hudTime = time; }
  frame = requestAnimationFrame(tick);
}

function randomizePad() {
  world = createWorld(world.width, world.height, world.bottomInset, world.topInset, randomPadPosition(world.padPosition));
}

function startFlight() {
  if (!ready || ship.phase === 'flying') return;
  const resume = ship.phase === 'paused';
  stopLoop();
  if (!resume) {
    if (ship.phase !== 'ready') randomizePad();
    ship = createFlight(world);
  }
  ship.phase = 'flying';
  publish();
  canvas.focus({ preventScroll: true });
  frame = requestAnimationFrame(tick);
}

function pauseFlight() {
  if (ship?.phase === 'crashed' && crashEffect?.elapsed < crashDuration) {
    settleCrash(false);
    return;
  }
  if (ship?.phase !== 'flying') return;
  ship.phase = 'paused';
  stopLoop();
  publish();
}

launch.addEventListener('click', startFlight);
pause.addEventListener('click', () => ship.phase === 'paused' ? startFlight() : pauseFlight());
restart.addEventListener('click', () => {
  if (!ready) return;
  stopLoop();
  randomizePad();
  ship = createFlight(world);
  publish();
  launch.focus({ preventScroll: true });
});

window.addEventListener('keydown', event => {
  const action = keyActions[event.code];
  // Space/Enter on real buttons keep their native activation behavior.
  if (event.target.closest('button, a')) return;
  if (action && ship?.phase === 'flying') {
    event.preventDefault();
    keys.add(event.code);
    syncHeld();
  }
  if (!event.repeat && event.code === 'KeyP') {
    event.preventDefault();
    if (ship?.phase === 'paused') startFlight(); else pauseFlight();
  }
  if (!event.repeat && event.code === 'KeyR' && ready) restart.click();
});
window.addEventListener('keyup', event => { keys.delete(event.code); syncHeld(); });
for (const button of buttons) {
  button.addEventListener('pointerdown', event => {
    if (button.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, button.dataset.action);
    syncHeld();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => { pointers.delete(event.pointerId); syncHeld(); });
  }
  button.addEventListener('keydown', event => {
    if ((event.code === 'Space' || event.code === 'Enter') && ship?.phase === 'flying') {
      event.preventDefault();
      pointers.set(`keyboard-${button.dataset.action}`, button.dataset.action);
      syncHeld();
    }
  });
  button.addEventListener('keyup', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      pointers.delete(`keyboard-${button.dataset.action}`);
      syncHeld();
    }
  });
  button.addEventListener('blur', () => {
    pointers.delete(`keyboard-${button.dataset.action}`);
    syncHeld();
  });
}
window.addEventListener('blur', pauseFlight);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseFlight(); });
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && ship?.phase === 'crashed' && crashEffect?.elapsed < crashDuration) settleCrash();
});

fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.addEventListener('click', async () => {
  pauseFlight();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await game.requestFullscreen();
  } catch {
    status.textContent = 'Fullscreen is unavailable. The game still fills this browser window.';
    fullscreen.title = status.textContent;
    fullscreen.querySelector('span').textContent = 'Unavailable';
  }
});
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === game;
  fullscreen.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreen.querySelector('span').textContent = active ? 'Exit fullscreen' : 'Fullscreen';
});

function resize() {
  const bounds = canvas.getBoundingClientRect();
  if (world && Math.abs(viewWidth - bounds.width) < 1 && Math.abs(viewHeight - bounds.height) < 1) return;
  const previousWorld = world;
  const previousShip = ship;
  stopLoop();
  viewWidth = bounds.width;
  viewHeight = bounds.height;
  // Keep very wide screens playable without stretching the drawing.
  const scale = Math.min(1, 1280 / bounds.width);
  const hudBottom = document.querySelector('.telemetry').getBoundingClientRect().bottom - bounds.top;
  const bottomInset = bounds.height <= 600 ? 80 : 120;
  world = createWorld(bounds.width * scale, bounds.height * scale, bottomInset * scale, (hudBottom + 16) * scale, previousWorld?.padPosition ?? randomPadPosition());
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  if (previousShip && previousShip.phase !== 'ready') {
    ship = {
      ...previousShip,
      x: previousShip.x / previousWorld.width * world.width,
      y: world.spawnY + (previousShip.y - previousWorld.spawnY) * (world.pad.y - world.spawnY) / (previousWorld.pad.y - previousWorld.spawnY),
      phase: ['flying', 'paused'].includes(previousShip.phase) ? 'paused' : previousShip.phase,
      thrusting: false,
    };
    ship.x = Math.max(26, Math.min(world.width - 26, ship.x));
    if (ship.phase === 'landed') ship.y = world.pad.y - RULES.footY;
  } else ship = createFlight(world);
  publish();
  if (ship.phase === 'paused') {
    message.textContent = 'The view changed size. Your fuel and progress are saved — resume when you’re ready.';
    status.textContent = message.textContent;
  }
}

if (!context) {
  title.textContent = 'This browser can’t draw the lander.';
  message.textContent = 'Try a browser with canvas support, or head back to the main page.';
} else {
  resize();
  new ResizeObserver(resize).observe(canvas);
  pilot.src = new URL('../tomi.svg', import.meta.url).href;
  pilot.decode().then(() => {
    ready = true;
    publish();
  }).catch(() => {
    title.textContent = 'Our pilot hasn’t arrived.';
    message.textContent = 'The robot image could not load. Refresh the page to try again.';
    status.textContent = message.textContent;
  });
}
