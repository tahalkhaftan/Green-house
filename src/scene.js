import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SENSOR_NAMES } from './simulation.js';

export function createScene(container, onMove, options={}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e8f0e9');
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100); camera.position.set(5.3, 4.6, 6.5);
  const renderer = options.renderer || new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const controls = options.controls || new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.minDistance = 3.2; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * .49; controls.update();
  const light = new THREE.DirectionalLight('#fff6d8', 2.6); light.position.set(3, 7, 4); light.castShadow = true; light.shadow.mapSize.set(1024,1024); light.shadow.camera.left = -5; light.shadow.camera.right = 5; light.shadow.camera.top = 5; light.shadow.camera.bottom = -5; scene.add(light);
  scene.add(new THREE.HemisphereLight('#f2f8e9', '#657d62', 2.2));
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra });
  const mesh = (geometry, material, pos, parent=scene) => { const m = new THREE.Mesh(geometry,material); m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  mesh(new THREE.BoxGeometry(2.7,.17,3.7), mat('#858e7b'), [0,-.1,0]);
  mesh(new THREE.PlaneGeometry(25,25),mat('#dce9d9'),[0,-.2,0]).rotation.x=-Math.PI/2;
  // Greenhouse footprint is 2 x 3 metres. Frame reaches approximately 2 metres.
  const frame=mat('#788d82',{metalness:.65,roughness:.4});
  for(const x of [-1,1]) for(const z of [-1.5,0,1.5]) mesh(new THREE.BoxGeometry(.04,1.6,.04),frame,[x,.8,z]);
  for(const z of [-1.5,0,1.5]) {
    mesh(new THREE.BoxGeometry(2,.04,.04),frame,[0,1.59,z]);
    for (const side of [-1,1]) {const beam=mesh(new THREE.BoxGeometry(1.08,.04,.04),frame,[side*.5,1.80,z]);beam.rotation.z=side*-.38;}
  }
  for(const x of [-1,1]) {mesh(new THREE.BoxGeometry(.04,.04,3),frame,[x,1.59,0]);mesh(new THREE.BoxGeometry(.04,.04,3),frame,[x,.1,0]);}
  mesh(new THREE.BoxGeometry(.04,.04,3),frame,[0,2.0,0]);
  const glass=mat('#d0ede6',{transparent:true,opacity:.16,metalness:.05,roughness:.25,side:THREE.DoubleSide,depthWrite:false});
  for(const x of [-1,1]) mesh(new THREE.PlaneGeometry(3,1.55),glass,[x,.8,0]).rotation.y=Math.PI/2;
  for(const side of [-1,1]) {const roof=mesh(new THREE.PlaneGeometry(1.08,3),glass,[side*.5,1.80,0]);roof.rotation.x=-Math.PI/2;roof.rotation.y=side*.38;}
  const bedMat=mat('#d8c8ab'),soilMat=mat('#59443a');
  for(const x of [-.52,.52]) {mesh(new THREE.BoxGeometry(.76,.28,2.53),bedMat,[x,.12,0]);mesh(new THREE.BoxGeometry(.7,.045,2.45),soilMat,[x,.28,0]);}
  const plantGroups=[];
  const leafGeometry=new THREE.SphereGeometry(1, 12, 8);
  for(let p=0;p<4;p++) {
    const root=new THREE.Group(); root.position.set(p%2 ? .52 : -.52,.31,p<2 ? -.65 : .65); scene.add(root);
    const growthGroup=new THREE.Group();root.add(growthGroup);
    const stem=mesh(new THREE.CylinderGeometry(.025,.042,.8,8),mat('#56844a'),[0,.4,0],growthGroup);
    const leaves=[];
    for(let i=0;i<8;i++) {
      const pivot=new THREE.Group(); pivot.position.y=.18+i*.08; pivot.rotation.y=i*2.39; growthGroup.add(pivot);
      const stalk=mesh(new THREE.CylinderGeometry(.01,.015,.2,5),mat('#658c4d'),[.09,.045,0],pivot);stalk.rotation.z=-.9;
      const leaf=mesh(leafGeometry,mat('#548e46'),[.23,.06,0],pivot);leaf.scale.set(.21,.045,.085);leaf.rotation.z=.25;
      leaves.push({pivot,leaf});
    }
    const fruits=[];
    for(let j=0;j<4;j++) {let t=mesh(new THREE.SphereGeometry(.065,12,10),mat('#d84a36'),[(j%2 ? .14 : -.12),.35+(j%3)*.12,(j<2 ? -.12 : .12)],growthGroup);fruits.push(t);}
    plantGroups.push({root,growthGroup,leaves,fruits,model:null});
  }
  // CC0 textured tomato plant: compression and textures are decoded locally.
  if(options.loadAssets!==false){
  const ktx2=new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder).load('/tomato.glb', gltf=>{
    const box=new THREE.Box3().setFromObject(gltf.scene),size=new THREE.Vector3();box.getSize(size);
    if(!size.y)return;
    for(const item of plantGroups){
      const holder=new THREE.Group(),model=gltf.scene.clone(true);
      model.scale.setScalar(1.1/size.y);model.position.y=-box.min.y*1.1/size.y;
      model.traverse(obj=>{if(obj.isMesh){obj.castShadow=true;obj.receiveShadow=true;const mats=Array.isArray(obj.material)?obj.material:[obj.material];const cloned=mats.map(m=>{const n=m.clone();n.userData.originalColor=n.color.clone();return n;});obj.material=Array.isArray(obj.material)?cloned:cloned[0];}});
      holder.add(model);item.root.add(holder);item.model=holder;item.growthGroup.visible=false;
    }
  },undefined,()=>{});
  }
  // Wall-mounted ventilation fan with a rotating motor and protective rim.
  const fan=new THREE.Group();fan.position.set(1.01,1.18,-.92);fan.rotation.y=Math.PI/2;scene.add(fan);
  mesh(new THREE.BoxGeometry(.51,.51,.06),mat('#879f91',{metalness:.45}),[0,0,0],fan);
  mesh(new THREE.CylinderGeometry(.22,.22,.07,32),mat('#334d44'),[0,0,.04],fan).rotation.x=Math.PI/2;
  const fanRotor=new THREE.Group();fanRotor.name='fan-rotor';fanRotor.position.z=.085;fan.add(fanRotor);
  for(let b=0;b<4;b++){const angle=b*Math.PI/2,blade=mesh(new THREE.BoxGeometry(.075,.17,.018),mat('#dce8de',{metalness:.45}),[-Math.sin(angle)*.09,Math.cos(angle)*.09,0],fanRotor);blade.rotation.z=angle+.25;}
  mesh(new THREE.SphereGeometry(.035,12,8),mat('#b8c7bb'),[0,0,.02],fanRotor);
  const fanRim=mesh(new THREE.TorusGeometry(.205,.012,8,32),mat('#d3dfd3',{metalness:.5}),[0,0,.11],fan);
  // Detailed electric radiant heater: dark grille, yellow elements and warm light.
  const heater=new THREE.Group();heater.position.set(.57,.18,-1.24);scene.add(heater);
  const metal=mat('#c8c8b7',{metalness:.55,roughness:.45});
  mesh(new THREE.BoxGeometry(.58,.40,.22),metal,[0,.22,0],heater);
  mesh(new THREE.BoxGeometry(.49,.27,.015),mat('#343831',{metalness:.15}),[0,.23,.119],heater);
  const heaterElement=mat('#927845',{emissive:'#ffc34a',emissiveIntensity:0,metalness:.15});
  for(let i=0;i<6;i++){const element=mesh(new THREE.BoxGeometry(.043,.225,.014),heaterElement,[-.18+i*.072,.23,.13],heater);element.name='heater-element';}
  for(let i=0;i<4;i++)mesh(new THREE.BoxGeometry(.49,.013,.012),mat('#b6b9aa',{metalness:.7}),[0,.13+i*.065,.147],heater);
  mesh(new THREE.BoxGeometry(.62,.045,.26),mat('#596b5e',{metalness:.4}),[0,.025,0],heater);
  mesh(new THREE.SphereGeometry(.018,12,8),mat('#d5a94e'),[.22,.37,.13],heater);
  const heaterLight=new THREE.PointLight('#ffbf40',0,1.6,2);heaterLight.name='heater-light';heaterLight.position.set(0,.25,.35);heater.add(heaterLight);
  // Overhead irrigation pipe and nozzles; each drop is animated only while pumping.
  const drops=[];const dropGeom=new THREE.SphereGeometry(.018,8,6),dropMat=new THREE.MeshBasicMaterial({color:'#36baf1',transparent:true,opacity:.82});
  const pipeMat=mat('#48645c',{metalness:.25});
  for(const x of [-.52,.52]){
    mesh(new THREE.BoxGeometry(.035,.035,2.45),pipeMat,[x,1.47,0]);
    for(const z of [-.72,.72]){
      mesh(new THREE.CylinderGeometry(.033,.045,.07,12),mat('#98a9a5'),[x,1.42,z]);
      for(let j=0;j<8;j++){const d=mesh(dropGeom,dropMat,[x,1.4,z]);d.castShadow=false;d.name='sprinkler-drop';drops.push({mesh:d,x,z,j});}
    }
  }
  mesh(new THREE.CylinderGeometry(.16,.16,.35,20),mat('#8cb7b6'),[-.75,.2,-1.26]);
  for(const x of [-.52,.52])mesh(new THREE.BoxGeometry(.025,.025,2.4),mat('#263f38'),[x,.32,0]);
  // Controller enclosure and sensor markers.
  mesh(new THREE.BoxGeometry(.34,.25,.12),mat('#d8e4dc'),[1.09,1.25,1.15]);
  const board=mesh(new THREE.BoxGeometry(.23,.13,.015),mat('#285e53'),[1.16,1.25,1.22]);
  for(let i=0;i<4;i++)mesh(new THREE.BoxGeometry(.025,.035,.016),mat('#d5ac52'),[1.105+i*.035,1.25,1.24]);
  const markers=[]; const group=new THREE.Group();scene.add(group);
  const markerColors=['#ec7960','#54aec3','#ae8860','#e0b855','#7d91d0'];
  for(let i=0;i<5;i++) {
    const g=new THREE.Group();g.userData.sensorIndex=i;group.add(g);
    const stem=mesh(new THREE.CylinderGeometry(.012,.012,.45,7),mat('#546f64'),[0,.23,0],g);stem.userData.sensorIndex=i;
    const head=mesh(new THREE.SphereGeometry(.09,18,12),mat(markerColors[i],{emissive:markerColors[i],emissiveIntensity:.15}),[0,.5,0],g);head.userData.sensorIndex=i;
    const ring=mesh(new THREE.TorusGeometry(.115,.012,6,24),mat('#ffffff'),[0,.5,0],g);ring.userData.sensorIndex=i;ring.rotation.x=Math.PI/2;
    markers.push(g);
  }
  // Animated conceptual packet dashes. They indicate direction, not measured RF fields.
  const packetDashes=[],noiseDashes=[];
  const dashGeometry=new THREE.CapsuleGeometry(.014,.065,2,5), blue=new THREE.MeshBasicMaterial({color:'#168ef0'}),red=new THREE.MeshBasicMaterial({color:'#ef5350'});
  for(let i=0;i<5;i++)for(let j=0;j<7;j++){const d=mesh(dashGeometry,blue,[0,0,0]);d.castShadow=false;d.name='radio-data-dash';packetDashes.push({mesh:d,i,j});}
  for(let j=0;j<30;j++){const d=mesh(dashGeometry,red,[0,0,0]);d.castShadow=false;d.name='radio-noise-dash';noiseDashes.push({mesh:d,j});}
  const toController=new THREE.Vector3(1.16,1.25,1.22),upVector=new THREE.Vector3(0,1,0),pathStart=new THREE.Vector3(),direction=new THREE.Vector3();
  const cables=new THREE.Group();scene.add(cables);
  function setCables(positions,mode) {
    cables.clear(); if(mode!=='wired')return;
    positions.forEach(p=>{
      const points=[new THREE.Vector3(p[0],.34,p[1]),new THREE.Vector3(p[0],.34,1.3),new THREE.Vector3(1.02,.34,1.3),new THREE.Vector3(1.02,1.25,1.3)];
      const curve=new THREE.CatmullRomCurve3(points);let line=new THREE.Mesh(new THREE.TubeGeometry(curve,32,.01,5),mat('#2f7d75'));cables.add(line);
    });
  }
  let drag=null;const ray=new THREE.Raycaster(), pointer=new THREE.Vector2(), dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-.31), at=new THREE.Vector3();
  function updatePointer(event){const r=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);}
  renderer.domElement.addEventListener('pointerdown',e=>{updatePointer(e);const hits=ray.intersectObjects(group.children,true);if(hits.length){drag=hits[0].object.userData.sensorIndex;controls.enabled=false;renderer.domElement.setPointerCapture(e.pointerId);renderer.domElement.style.cursor='grabbing';}});
  renderer.domElement.addEventListener('pointermove',e=>{if(drag===null)return;updatePointer(e);if(ray.ray.intersectPlane(dragPlane,at)){onMove(drag,[THREE.MathUtils.clamp(at.x,-.9,.9),THREE.MathUtils.clamp(at.z,-1.35,1.35)]);}});
  const release=()=>{drag=null;controls.enabled=true;renderer.domElement.style.cursor='grab';};renderer.domElement.addEventListener('pointerup',release);renderer.domElement.addEventListener('pointercancel',release);
  if(options.observeResize!==false){const observer=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);});observer.observe(container);}
  const clock=options.clock||(()=>performance.now());
  let oldMode='';let oldCoords='';let motion=0,lastTime=clock();
  function render(sim,running=false) {
    const now=clock(),dt=Math.min(.05,Math.max(0,(now-lastTime)/1000));lastTime=now;if(running)motion+=dt;
    sim.positions.forEach((p,i)=>markers[i].position.set(p[0],.31,p[1]));
    const coords=JSON.stringify(sim.positions);if(oldMode!==sim.config.mode||oldCoords!==coords){setCables(sim.positions,sim.config.mode);oldMode=sim.config.mode;oldCoords=coords;}
    sim.plants.forEach((p,i)=>{
      const item=plantGroups[i];const s=.42+p.growth*.7;item.growthGroup.scale.set(s,s,s);
      item.leaves.forEach(({pivot,leaf},j)=>{pivot.rotation.z=-(.15+p.stress*.9);leaf.material.color.set(p.stress>.55?'#9b9d49':'#548e46');});
      item.fruits.forEach(f=>f.visible=p.growth>.45);
      if(item.model){const scale=.22+p.growth*.68;item.model.scale.setScalar(scale);item.model.rotation.z=p.stress*.28;item.model.traverse(obj=>{if(obj.isMesh){for(const m of (Array.isArray(obj.material)?obj.material:[obj.material]))if(m.name.includes('leaf'))m.color.copy(m.userData.originalColor).lerp(new THREE.Color('#ad9c45'),p.stress*.8);}});}
    });
    if(sim.actuators.fan&&running)fanRotor.rotation.z+=dt*9;
    heaterElement.emissiveIntensity=sim.actuators.heat?2.4:0;heaterLight.intensity=sim.actuators.heat?4.0:0;
    for(const drop of drops){const phase=(motion*1.5+drop.j/8)%1,spread=(drop.j%2?1:-1)*.16*phase;drop.mesh.visible=sim.actuators.pump&&sim.env.water>0;drop.mesh.position.set(drop.x+spread,1.39-phase*.93,drop.z+Math.sin(drop.j*2.4)*.14*phase);}
    const show=sim.config.showWaves&&sim.config.mode==='wireless'&&!sim.config.wirelessBreak;
    const transmitting=show&&sim.config.interference<100&&sim.config.traffic<100;
    for(const d of packetDashes){d.mesh.visible=transmitting;if(!d.mesh.visible)continue;const p=sim.positions[d.i],t=(motion*.45+d.j/7)%1;pathStart.set(p[0],.81,p[1]);direction.copy(toController).sub(pathStart).normalize();d.mesh.position.copy(pathStart).lerp(toController,t);d.mesh.position.y+=Math.sin(t*Math.PI)*.13;d.mesh.quaternion.setFromUnitVectors(upVector,direction);}
    const interference=Math.max(sim.config.interference,sim.config.traffic)/100;
    for(const d of noiseDashes){d.mesh.visible=show&&d.j<Math.ceil(interference*noiseDashes.length);if(!d.mesh.visible)continue;const phase=(motion*.6+d.j*.137)%1;d.mesh.position.set(-.9+((d.j*37)%180)/100, .6+((d.j*13)%80)/100, -1.25+phase*2.5);d.mesh.rotation.set(.65,d.j*.9,1.0+d.j*.2);}

    controls.update();renderer.render(scene,camera);
  }
  renderer.domElement.style.cursor='grab';return {render,markers};
}
