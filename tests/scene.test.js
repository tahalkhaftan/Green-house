import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createScene } from '../src/scene.js';
import { Simulation } from '../src/simulation.js';

test('3D equipment and communication indicators follow real simulation state',()=>{
 globalThis.devicePixelRatio=1;let clock=0;
 const canvas={style:{},addEventListener(){},setPointerCapture(){}};
 const renderer={domElement:canvas,shadowMap:{},setPixelRatio(){},render(scene){this.scene=scene;}};
 const controls={target:{set(){}},update(){}};
 const container={appendChild(){},clientWidth:800,clientHeight:600};
 const view=createScene(container,()=>{},{renderer,controls,loadAssets:false,observeResize:false,clock:()=>clock});
 const sim=new Simulation(JSON.parse(fs.readFileSync('public/weather-2021-2025.json','utf8')));
 sim.config.showWaves=true;sim.actuators.fan=true;sim.actuators.pump=true;sim.actuators.heat=true;
 clock+=40;view.render(sim,true);
 const scene=renderer.scene,fan=scene.getObjectByName('fan-rotor'),element=scene.getObjectByName('heater-element'),light=scene.getObjectByName('heater-light');
 const drop=scene.getObjectByName('sprinkler-drop'),packet=scene.getObjectByName('radio-data-dash'),noise=scene.getObjectByName('radio-noise-dash');
 assert.ok(fan.rotation.z>0);assert.ok(element.material.emissiveIntensity>0);assert.ok(light.intensity>0);
 assert.equal(drop.visible,true);assert.equal(packet.visible,true);assert.equal(noise.visible,true);
 const angle=fan.rotation.z;clock+=40;view.render(sim,false);assert.equal(fan.rotation.z,angle);
 sim.setLinkCut('wireless',true);sim.actuators.pump=false;sim.actuators.heat=false;clock+=40;view.render(sim,true);
 assert.equal(packet.visible,false);assert.equal(noise.visible,false);assert.equal(drop.visible,false);
 assert.equal(element.material.emissiveIntensity,0);assert.equal(light.intensity,0);
 sim.actuators.fan=false;const stopped=fan.rotation.z;clock+=40;view.render(sim,true);assert.equal(fan.rotation.z,stopped);
});
