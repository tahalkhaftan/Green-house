import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Simulation,YEAR_MINUTES,forecast,wirelessSuccessChance,isDaylight} from '../src/simulation.js';
const weather=JSON.parse(fs.readFileSync('public/weather-2020-2025.json','utf8'));
test('real weather covers six complete years; tomato starts in spring',()=>{
 assert.equal(weather.rows.length,52608);assert.equal(weather.start_year,2020);assert.equal(weather.end_year,2025);
 const sim=new Simulation(weather);assert.equal(sim.config.startDate,'2020-03-20');assert.equal(sim.startOffsetHours,79*24);
 assert.throws(()=>new Simulation({...weather,rows:weather.rows.slice(0,168)}),/ناقص/);
});
test('default year has full hourly records and climate history',()=>{
 const sim=new Simulation(weather);sim.step(YEAR_MINUTES+60);assert.equal(sim.minutes,YEAR_MINUTES);assert.equal(sim.finishReason,'completed');assert.equal(sim.hourly.length,8760);assert.equal(sim.frames.length,8761);
});
test('five years account for leap day and retain hourly replay data',()=>{
 const sim=new Simulation(weather,{years:5});assert.equal(sim.totalMinutes,1826*1440);sim.step(sim.totalMinutes+60);
 assert.equal(sim.finishReason,'completed');assert.equal(sim.minutes,1826*1440);assert.equal(sim.hourly.length,43824);assert.equal(sim.frames.length,43825);
 assert.equal(sim.exportResult().hourly.rows.length,43824);assert.equal(sim.exportResult().replay_frames.length,43825);
});
test('alternative sowing date and extended duration use correct historical offset',()=>{
 const sim=new Simulation(weather,{startDate:'2020-05-21',years:1});sim.step(100);sim.setYears(4);
 assert.equal(sim.minutes,100);assert.equal(sim.totalMinutes,1461*1440);assert.equal(sim.config.years,4);assert.equal(sim.config.startDate,'2020-05-21');
});
test('congestion affects every percentage and delivery declines as traffic rises',()=>{
 const levels=[0,10,25,50,75,90,100],chances=levels.map(v=>wirelessSuccessChance(v,20,.5));
 assert.ok(chances.every((value,i)=>i===0||value<chances[i-1]));assert.equal(chances.at(-1),0);
 const rates=levels.map(traffic=>{const sim=new Simulation(weather,{traffic,automatic:false});sim.step(600);return sim.summary('wireless').ratio;});
 assert.ok(rates.every((value,i)=>i===0||value<rates[i-1]),String(rates));assert.equal(rates.at(-1),0);
});
test('cutting wireless stops new delivery immediately and keeps heater state',()=>{
 const sim=new Simulation(weather);const received=sim.stats.wireless.delivered;sim.actuators.heat=true;sim.setLinkCut('wireless',true);
 assert.equal(sim.isFresh(0),false);sim.step(60);assert.equal(sim.stats.wireless.delivered,received);assert.equal(sim.actuators.heat,true);assert.ok(sim.stats.wired.delivered>5);
 sim.setLinkCut('wireless',false);assert.equal(sim.isFresh(0),false);sim.step(5);assert.equal(sim.isFresh(0),true);
});
test('a broken wire stops delivery and invalidates data immediately',()=>{
 const sim=new Simulation(weather,{mode:'wired',interference:0,traffic:0});sim.setLinkCut('wired',true);const before=sim.stats.wired.delivered;
 assert.equal(sim.isFresh(0),false);sim.step(120);assert.equal(sim.stats.wired.delivered,before);assert.ok(sim.stats.wireless.delivered>100);
});
test('disconnected heater can kill the plant and stops simulated time',()=>{
 const sim=new Simulation(weather);sim.actuators.heat=true;sim.setLinkCut('wireless',true);sim.step(7*24*60);
 assert.equal(sim.finishReason,'death');assert.equal(sim.plants[0].stress,1);const end=sim.minutes;sim.step(1000);assert.equal(sim.minutes,end);
});
test('whole-run average uses every five-minute step, not only the last hour',()=>{
 const sim=new Simulation(weather);let sum=0;for(let i=0;i<100;i++){sim.step(5);sum+=sim.env.temp;}
 const report=sim.totalReport();assert.equal(report.samples,100);assert.ok(Math.abs(report.average.temp-sum/100)<1e-9);assert.equal(report.minutes,500);
});
test('replay restores the historical environment without mutating final state',()=>{
 const sim=new Simulation(weather,{automatic:false});sim.actuators.lamp=true;sim.step(60);const past=sim.frames[1];sim.actuators.lamp=false;sim.step(120);
 const now=sim.minutes,replay=sim.replayAt(1);assert.equal(replay.minutes,60);assert.equal(replay.env.temp,past.e[0]);assert.equal(replay.actuators.lamp,true);assert.equal(sim.minutes,now);assert.equal(sim.actuators.lamp,false);
});
test('mist increases humidity; root watering is tracked separately',()=>{
 const fog=new Simulation(weather,{automatic:false,autoRefill:false}),control=new Simulation(weather,{automatic:false,autoRefill:false});fog.actuators.mist=true;fog.step(5);control.step(5);
 assert.ok(fog.env.mistUsed>0);assert.ok(fog.env.humidity>control.env.humidity);assert.equal(fog.env.soil,control.env.soil);
});
test('day/night and lamp modify light and energy',()=>{
 assert.equal(isDaylight(Date.UTC(2020,2,20,0)),false);assert.equal(isDaylight(Date.UTC(2020,2,20,12)),true);
 const lit=new Simulation(weather,{automatic:false}),dark=new Simulation(weather,{automatic:false});lit.actuators.lamp=true;lit.step(5);dark.step(5);
 assert.equal(lit.env.isDay,false);assert.ok(lit.env.light>dark.env.light);assert.ok(lit.env.lampKwh>0);
});
test('old and multi-target PyTorch exports evaluate consistently',()=>{
 const weights=[Array(16).fill(0)],base={mean:Array(16).fill(0),std:Array(16).fill(1),layers:[{weights,bias:[2],activation:'linear'}]};
 assert.equal(forecast(base,Array(4).fill([20,60,500,200])),22);
 const multi={...base,target_mean:[0,0],target_std:[1,1],layers:[{weights:[...weights,Array(16).fill(0)],bias:[2,-3],activation:'linear'}]};
 assert.deepEqual(forecast(multi,Array(4).fill([20,60,500,200])),{temp:22,humidity:57});
});

test('trained independent temperature and humidity models execute after enough history',()=>{
 const model=JSON.parse(fs.readFileSync('public/model.json','utf8')),history=Array.from({length:12},()=>[20,65,420,100]);
 const short=forecast(model,history.slice(-4)),full=forecast(model,history);
 assert.ok(Number.isFinite(short.temp));assert.equal(short.humidity,null);assert.ok(Number.isFinite(full.temp));assert.ok(Number.isFinite(full.humidity));
});
