import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, forecast } from '../src/simulation.js';
const trace = { values: [['2019-12-16', 23, 60, 500, 200]], source:'test' };
test('unfavorable conditions stop growth and cause visible stress', () => {
 const sim = new Simulation(trace); sim.env.soil = 10; sim.config.automatic = false;
 const growth = sim.plants[0].growth; sim.step(200);
 assert.equal(sim.plants[0].growth, growth); assert.ok(sim.plants[0].stress > 0);
});
test('a broken wire loses every new packet while wireless continues', () => {
 const sim = new Simulation(trace, {wiredBreak:true, interference:0, traffic:0});
 sim.step(120); assert.equal(sim.stats.wired.delivered, 0); assert.ok(sim.stats.wireless.delivered > 0);
});
test('forecast evaluates exported linear layer exactly', () => {
 const m={mean:Array(16).fill(0),std:Array(16).fill(1),layers:[{weights:[Array(16).fill(0)],bias:[2],activation:'linear'}]};
 assert.equal(forecast(m, Array(4).fill([20,60,500,200])),22);
});

test('the heat scenario causes stress and freezes further growth', () => {
 const sim=new Simulation(trace,{scenario:'heat',automatic:false});sim.step(1000);
 assert.ok(sim.plants[0].stress>0);const growth=sim.plants[0].growth;
 sim.step(200);assert.equal(sim.plants[0].growth,growth);
});
