// Move sounds, made with Web Audio rather than shipped as files: a soft knock for a move, a sharper one for a
// capture, two rising notes for check. Played by the board when it steps one move (Settings → Sounds).
export type Sound = "move" | "capture" | "check" | "castle";

let ctx: AudioContext | null = null;
let last = 0;

function knock(at: number, freq: number, gain: number, length: number) {
  const c = ctx!;
  const osc = c.createOscillator(), env = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, at + length);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env).connect(c.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

function noise(at: number, gain: number, length: number) {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = c.createBufferSource(), filter = c.createBiquadFilter(), env = c.createGain();
  src.buffer = buf;
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(c.destination);
  src.start(at);
}

export function play(sound: Sound) {
  const now = performance.now();
  if (now - last < 60) return;   // two boards stepping together make one sound
  last = now;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + 0.005;
    if (sound === "move") knock(t, 420, 0.22, 0.09);
    else if (sound === "castle") { knock(t, 420, 0.2, 0.08); knock(t + 0.09, 380, 0.2, 0.08); }
    else if (sound === "capture") { knock(t, 300, 0.3, 0.12); noise(t, 0.25, 0.05); }
    else { knock(t, 520, 0.18, 0.1); knock(t + 0.1, 700, 0.18, 0.14); }
  } catch { /* no Web Audio here: stay quiet */ }
}
