export const SENSOR_NAMES = ['دما', 'رطوبت هوا', 'رطوبت خاک', 'نور', 'دی‌اکسیدکربن'];
export const SENSOR_UNITS = ['°C', '%', '%', 'µmol', 'ppm'];
export const SENSOR_KEYS = ['temp', 'humidity', 'soil', 'light', 'co2'];
export const DEFAULT_POSITIONS = [[-0.72,-0.58], [0.7,-0.55], [-0.7,0.5], [0.67,0.5], [0,0]];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}
function freshStats() {
  return { generated: 0, delivered: 0, retries: 0, packetLoss: 0, attempts: 0, totalLatencyMs: 0, maxLatencyMs: 0, lastLatencyMs: [null,null,null,null,null], last: [null,null,null,null,null], lastTime: [null,null,null,null,null] };
}

export class Simulation {
  constructor(trace, config = {}) {
    if (!trace || !Array.isArray(trace.values) || trace.values.length === 0) throw new Error('دادهٔ اقلیمی پیدا نشد');
    this.trace = trace;
    this.rng = { wired: randomSource(1208), wireless: randomSource(1349) };
    this.config = { mode: 'wireless', interference: 25, traffic: 15, sampleMinutes: 5, wiredBreak: false, automatic: true, scenario: 'normal', ...config };
    this.positions = DEFAULT_POSITIONS.map(p => [...p]);
    this.minutes = 0; this.nextSample = 0;
    const row = trace.values[0];
    this.env = { temp: row[1], humidity: row[2], co2: row[3], light: row[4], soil: 54 };
    this.actuators = { fan: false, pump: false, lamp: false, heat: false };
    this.plants = Array.from({ length: 4 }, (_, index) => ({ growth: .14 + index * .075, stress: 0 }));
    this.stats = { wired: freshStats(), wireless: freshStats() };
    this.records = []; this.history = []; this.recent = [];
    this.takeSample();
  }
  baseline() {
    const i = Math.floor(this.minutes / 60) % this.trace.values.length;
    return this.trace.values[i];
  }
  getGood() { const e = this.env; return e.temp >= 18 && e.temp <= 30 && e.humidity >= 40 && e.humidity <= 85 && e.soil >= 35 && e.soil <= 80; }
  reportCondition() {
    if (this.env.temp < 18 || this.env.temp > 30) return 'دمای نامناسب';
    if (this.env.humidity < 40 || this.env.humidity > 85) return 'رطوبت هوای نامناسب';
    if (this.env.soil < 35 || this.env.soil > 80) return 'رطوبت خاک نامناسب';
    return 'شرایط مناسب';
  }
  setMode(mode) { if (mode === 'wired' || mode === 'wireless') this.config.mode = mode; }
  step(minutes = 5) {
    const loops = Math.max(1, Math.round(minutes / 5));
    for (let k=0; k<loops; k++) this.advanceFiveMinutes();
  }
  advanceFiveMinutes() {
    const baseline = this.baseline(), e = this.env;
    if (this.config.automatic) {
      const s = this.stats[this.config.mode];
      const fresh = i => s.lastTime[i] !== null && this.minutes - s.lastTime[i] <= this.config.sampleMinutes * 3;
      // Use only delivered, fresh values for automatic decisions.
      if (fresh(0)) { if (s.last[0] > 28) this.actuators.fan = true; else if (s.last[0] < 25.5) this.actuators.fan = false; }
      if (fresh(2)) { if (s.last[2] < 40) this.actuators.pump = true; else if (s.last[2] > 59) this.actuators.pump = false; }
    }
    // A deliberately simplified dynamic offset around the observed historical indoor trace.
    const airTarget = baseline[1] + (this.config.scenario === 'heat' ? 18 : this.config.scenario === 'cold' ? -15 : 0);
    e.temp += (airTarget - e.temp) * .025 + (this.actuators.heat ? .045 : 0) - (this.actuators.fan ? .055 : 0) + (this.actuators.lamp ? .008 : 0);
    e.humidity += (baseline[2] - e.humidity) * .025 + (this.actuators.pump ? .025 : 0) - (this.actuators.fan ? .035 : 0);
    e.co2 += (baseline[3] - e.co2) * .03 - (this.actuators.fan ? 1.0 : 0);
    e.light = Math.max(0, baseline[4] + (this.actuators.lamp ? 180 : 0));
    e.soil += (this.actuators.pump ? .20 : 0) - (this.config.scenario === 'drought' ? .30 : 0) - .012 - Math.max(0, e.temp - 22) * .001;
    e.temp = clamp(e.temp, 4, 50); e.humidity = clamp(e.humidity, 5, 99); e.soil = clamp(e.soil, 0, 100); e.co2 = clamp(e.co2, 250, 2000);
    for (const plant of this.plants) {
      if (this.getGood()) { plant.stress = Math.max(0, plant.stress - .0009); if (e.light > 50) plant.growth = Math.min(1, plant.growth + .00055); }
      else plant.stress = Math.min(1, plant.stress + .0018);
    }
    this.minutes += 5;
    while (this.minutes >= this.nextSample) { this.takeSample(); }
  }
  takeSample() {
    const measurements = SENSOR_KEYS.map(key => this.env[key]);
    for (let i=0; i<5; i++) {
      for (const mode of ['wired', 'wireless']) {
        const stats = this.stats[mode]; stats.generated++;
        // Relative, illustrative impairment parameters. No claim of measured BER or BLE PHY.
        const position = this.positions[i];
        const distance = Math.hypot(position[0], position[1]);
        const p = mode === 'wired' ? (this.config.wiredBreak ? 1 : .001) :
          clamp(.005 + .58 * (this.config.interference / 100) ** 2 + .13 * (this.config.traffic / 100) ** 2 + .025 * distance, 0, .96);
        let success = false, tries = 0;
        for (let attempt=0; attempt<3; attempt++) {
          tries++; stats.attempts++;
          if (this.rng[mode]() >= p) { success = true; break; }
          stats.packetLoss++;
          if (attempt < 2) stats.retries++;
        }
        const latency = success ? Math.round((mode === 'wired' ? 8 : 25 + .35 * this.config.traffic) + (tries - 1) * (mode === 'wired' ? 15 : 30)) : null;
        if (success) { stats.delivered++; stats.last[i] = measurements[i]; stats.lastTime[i] = this.minutes; stats.totalLatencyMs += latency; stats.maxLatencyMs = Math.max(stats.maxLatencyMs,latency); stats.lastLatencyMs[i] = latency; }
        this.records.push({ minute: this.minutes, link: mode, sensor: SENSOR_KEYS[i], actual: +measurements[i].toFixed(3), received: success ? +measurements[i].toFixed(3) : null, attempts: tries, latency_ms: latency, delivered: success });
      }
    }
    if (this.records.length > 12000) this.records.splice(0, this.records.length - 12000);
    const selected = this.stats[this.config.mode];
    this.recent.push({ minute: this.minutes, temp: this.env.temp, humidity: this.env.humidity, soil: this.env.soil, received: selected.last[0] });
    if (this.recent.length > 140) this.recent.shift();
    const s = this.stats[this.config.mode];
    const ids = [0, 1, 4, 3];
    const allFresh = ids.every(i => s.lastTime[i] === this.minutes);
    if (allFresh && this.config.sampleMinutes === 5) {
      this.history.push(ids.map(i => s.last[i]));
      if (this.history.length > 4) this.history.shift();
    } else {
      this.history = [];
    }
    this.nextSample = this.minutes + Math.max(5, this.config.sampleMinutes);
  }
  summary(mode = this.config.mode) {
    const s = this.stats[mode];
    return { ...s, ratio: s.generated ? 100 * s.delivered / s.generated : 0, age: s.lastTime.map(t => t === null ? null : this.minutes - t) };
  }
  exportResult() {
    return { schema: 1, created_at: new Date().toISOString(), data_source: this.trace.source, scenario: this.config, sensor_positions: this.positions, simulated_minutes: this.minutes, env: this.env, plants: this.plants, statistics: this.stats, records: this.records, note: 'Historical baseline; greenhouse and radio links use illustrative, uncalibrated models.' };
  }
}
export function forecast(model, history) {
  if (!model || history.length < 4) return null;
  let values = history.slice(-4).flat().map((x, i) => (x - model.mean[i]) / model.std[i]);
  for (const layer of model.layers) values = layer.weights.map((row, i) => {
    let sum = layer.bias[i]; for (let j=0; j<row.length; j++) sum += row[j] * values[j];
    return layer.activation === 'relu' ? Math.max(0, sum) : sum;
  });
  return history.at(-1)[0] + values[0];
}
