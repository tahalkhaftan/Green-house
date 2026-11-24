import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createScene} from '../src/scene.js';
import {Simulation} from '../src/simulation.js';

test('3D equipment, day/night, and radio dashes follow simulation state',()=>{
 globalThis.devicePixelRatio=1;let clock=0;
 const canvas={style:{},addEventListener(){},setPointerCapture(){}};
 const renderer={domElement:canvas,shadowMap:{},setPixelRatio(){},render(scene){this.scene=scene;}};
 const controls={target:{set(){}},update(){}};const container={appendChild(){},clientWidth:800,clientHeight:600};
 const view=createScene(container,()=>{},{renderer,controls,loadAssets:false,observeResize:false,clock:()=>clock});
 const sim=new Simulation(JSON.parse(fs.readFileSync('public/weather-2020-2025.json','utf8')));
 sim.config.showWaves=true;sim.actuators.fan=true;sim.actuators.mist=true;sim.actuators.heat=true;sim.actuators.lamp=true;
 clock+=40;view.render(sim,true);const scene=renderer.scene,fan=scene.getObjectByName('fan-rotor'),heat=scene.getObjectByName('heater-element'),light=scene.getObjectByName('heater-light'),lamp=scene.getObjectByName('lamp-led'),lampLight=scene.getObjectByName('lamp-light'),drop=scene.getObjectByName('sprinkler-drop'),noise=scene.getObjectByName('radio-noise-dash');
 assert.ok(fan.rotation.z>0);assert.ok(heat.material.emissiveIntensity>0);assert.ok(light.intensity>0);assert.ok(lamp.material.emissiveIntensity>0);assert.ok(lampLight.intensity>0);assert.equal(drop.visible,true);assert.equal(noise.visible,true);
 let count=()=>{let n=0;scene.traverse(o=>{if(o.name==='radio-data-dash'&&o.visible)n++;});return n;};sim.config.traffic=10;view.render(sim,false);const low=count();sim.config.traffic=80;view.render(sim,false);assert.ok(count()<low);
 const angle=fan.rotation.z;clock+=40;view.render(sim,false);assert.equal(fan.rotation.z,angle);
 sim.setLinkCut('wireless',true);sim.actuators.mist=false;sim.actuators.heat=false;sim.actuators.lamp=false;clock+=40;view.render(sim,true);
 assert.equal(count(),0);assert.equal(noise.visible,false);assert.equal(drop.visible,false);assert.equal(heat.material.emissiveIntensity,0);assert.equal(lampLight.intensity,0);
 sim.actuators.fan=false;const stopped=fan.rotation.z;clock+=40;view.render(sim,true);assert.equal(fan.rotation.z,stopped);
 const sun=scene.getObjectByName('sky-sun'),moon=scene.getObjectByName('sky-moon'),ambient=scene.getObjectByName('ambient-sky-light'),sunlight=scene.getObjectByName('ambient-sun-light');
 sim.env.isDay=false;view.render(sim,false);assert.equal(sun.visible,false);assert.equal(moon.visible,true);
 const colour=scene.background.getHexString(),brightness=[ambient.intensity,sunlight.intensity];
 sim.env.isDay=true;view.render(sim,false);assert.equal(sun.visible,true);assert.equal(moon.visible,false);assert.equal(scene.background.getHexString(),colour);assert.deepEqual([ambient.intensity,sunlight.intensity],brightness);
});
