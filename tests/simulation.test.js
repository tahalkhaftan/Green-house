import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation,YEAR_MINUTES,forecast} from '../src/simulation.js';
const weather=JSON.parse(fs.readFileSync('public/weather-2021-2025.json','utf8'));
test('weather contains five contiguous historical years including leap day',()=>{
 assert.equal(weather.rows.length,43824);assert.equal(weather.start_year,2021);assert.equal(weather.end_year,2025);
 assert.notDeepEqual(weather.rows[0],weather.rows[8760]);
 assert.throws(()=>new Simulation({...weather,rows:weather.rows.slice(0,168)}),/ناقص/);
});
test('one-year default ends at the right time, without wrapping weather',()=>{
 const sim=new Simulation(weather);sim.step(YEAR_MINUTES+24*60);
 assert.equal(sim.minutes,YEAR_MINUTES);assert.equal(sim.finishReason,'completed');assert.equal(sim.hourly.length,8760);
 assert.deepEqual(sim.baseline(),weather.rows[8760]);
});
test('a five-year simulation accounts for leap year and retains all hourly data',()=>{
 const sim=new Simulation(weather,{years:5});assert.equal(sim.totalMinutes,1826*1440);sim.step(sim.totalMinutes+60);
 assert.equal(sim.finishReason,'completed');assert.equal(sim.minutes,1826*1440);assert.equal(sim.hourly.length,43824);
 assert.equal(sim.exportResult().hourly.rows.length,43824);assert.deepEqual(sim.baseline(),weather.rows.at(-1));
});
test('duration can be extended without resetting the state',()=>{
 const sim=new Simulation(weather,{years:1});sim.step(100);sim.setYears(4);
 assert.equal(sim.minutes,100);assert.equal(sim.totalMinutes,1461*1440);assert.equal(sim.config.years,4);
});
test('full wireless traffic blocks every new message while healthy wire continues',()=>{
 const sim=new Simulation(weather,{traffic:100});sim.step(120);
 assert.equal(sim.stats.wireless.delivered,0);assert.equal(sim.stats.wireless.generated,125);assert.ok(sim.stats.wired.delivered>100);
});
test('turning wireless off invalidates readings immediately and stops every new delivery',()=>{
 const sim=new Simulation(weather);assert.equal(sim.isFresh(0),true);const delivered=sim.stats.wireless.delivered;
 sim.actuators.heat=true;sim.setLinkCut('wireless',true);assert.equal(sim.isFresh(0),false);
 sim.step(60);assert.equal(sim.stats.wireless.delivered,delivered);assert.equal(sim.actuators.heat,true);assert.ok(sim.stats.wired.delivered>5);
 sim.setLinkCut('wireless',false);assert.equal(sim.isFresh(0),false);sim.step(5);assert.equal(sim.isFresh(0),true);
});
test('a broken cable blocks every message immediately',()=>{
 const sim=new Simulation(weather,{mode:'wired',interference:0,traffic:0});sim.setLinkCut('wired',true);assert.equal(sim.isFresh(0),false);
 const before=sim.stats.wired.delivered;sim.step(120);assert.equal(sim.stats.wired.delivered,before);assert.ok(sim.stats.wireless.delivered>100);
});
test('a disconnected heater holds its state, harms the plant and stops the experiment',()=>{
 const sim=new Simulation(weather);sim.actuators.heat=true;sim.setLinkCut('wireless',true);
 sim.step(24*60);assert.equal(sim.actuators.heat,true);assert.ok(sim.env.temp>35);assert.ok(sim.plants[0].stress>0);
 sim.step(7*24*60);assert.equal(sim.finishReason,'death');assert.equal(sim.plants[0].stress,1);
 const end=sim.minutes;sim.step(1000);assert.equal(sim.minutes,end);
});
test('poor conditions stop seedling growth',()=>{
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
