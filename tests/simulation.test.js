import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation,YEAR_MINUTES,forecast} from '../src/simulation.js';
const weather=JSON.parse(fs.readFileSync('public/weather-2023.json','utf8'));
test('a genuine full year of hourly historical outdoor weather is required',()=>{
 assert.equal(weather.rows.length,8760);assert.notEqual(weather.rows[0][0],weather.rows[180*24][0]);
 assert.throws(()=>new Simulation({rows:weather.rows.slice(0,168)}),/۸۷۶۰/);
});
test('normal scenario can run every hour of the year and ends without cycling weather',()=>{
 const sim=new Simulation(weather);sim.step(YEAR_MINUTES+24*60);
 assert.equal(sim.minutes,YEAR_MINUTES);assert.equal(sim.finishReason,'completed');assert.equal(sim.hourly.length,8760);
 assert.deepEqual(sim.baseline(),weather.rows.at(-1));
 assert.equal(sim.exportResult().hourly.rows.length,8760);
});
test('full wireless traffic blocks every new message while healthy wire continues',()=>{
 const sim=new Simulation(weather,{traffic:100});sim.step(120);
 assert.equal(sim.stats.wireless.delivered,0);assert.equal(sim.stats.wireless.generated,125);
 assert.ok(sim.stats.wired.delivered>100);
});
test('a broken cable blocks every message',()=>{
 const sim=new Simulation(weather,{wiredBreak:true,interference:0,traffic:0});sim.step(120);
 assert.equal(sim.stats.wired.delivered,0);assert.ok(sim.stats.wireless.delivered>100);
});
test('a disconnected heater keeps its last state, causes harm, and halts the experiment',()=>{
 const sim=new Simulation(weather);sim.config.traffic=100;sim.actuators.heat=true;
 sim.stats.wireless.lastTime=sim.stats.wireless.lastTime.map(()=>-20);
 sim.step(24*60);assert.equal(sim.actuators.heat,true);assert.ok(sim.env.temp>35);assert.ok(sim.plants[0].stress>0);
 sim.step(7*24*60);assert.equal(sim.finishReason,'death');assert.equal(sim.plants[0].stress,1);
 const end=sim.minutes;sim.step(1000);assert.equal(sim.minutes,end);
});
test('poor conditions stop seedling growth and sustained heat harms mature plant',()=>{
 const sim=new Simulation(weather,{automatic:false,scenario:'heat'});sim.env.soil=10;
 const growth=sim.plants[0].growth;sim.step(200);assert.equal(sim.plants[0].growth,growth);assert.ok(sim.plants[0].stress>0);
});
test('water pump draws from a finite reservoir and refill is optional',()=>{
 const sim=new Simulation(weather,{automatic:false,autoRefill:false});sim.actuators.pump=true;sim.step(60);
 assert.ok(sim.env.water<30);assert.ok(sim.env.waterUsed>0);assert.equal(sim.env.waterAdded,0);
});
test('forecast evaluates the exported PyTorch network layers',()=>{
 const m={mean:Array(16).fill(0),std:Array(16).fill(1),layers:[{weights:[Array(16).fill(0)],bias:[2],activation:'linear'}]};
 assert.equal(forecast(m,Array(4).fill([20,60,500,200])),22);
});
