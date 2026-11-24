import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SENSOR_NAMES } from './simulation.js';

export function createScene(container, onMove) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e8f0e9');
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100); camera.position.set(5.3, 4.6, 6.5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.minDistance = 3.2; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * .49; controls.update();
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
  // Fan, heater, irrigation pipes and a cooling-water reservoir are visible equipment.
  const fan=new THREE.Group();fan.position.set(1.01,1.18,-.92);fan.rotation.y=Math.PI/2;scene.add(fan);
  mesh(new THREE.CylinderGeometry(.22,.22,.05,24),mat('#647e74'),[0,0,0],fan).rotation.x=Math.PI/2;
  const fanRotor=new THREE.Group();fanRotor.position.z=.04;fan.add(fanRotor);
  for(let b=0;b<4;b++){const blade=mesh(new THREE.BoxGeometry(.05,.17,.025),mat('#d3e1d6'),[0,.1,0],fanRotor);blade.rotation.z=b*Math.PI/2;blade.position.set(-Math.sin(b*Math.PI/2)*.09,Math.cos(b*Math.PI/2)*.09,0);}
  const heater=mesh(new THREE.BoxGeometry(.5,.3,.12),mat('#d7c7b0',{emissive:'#9a3019',emissiveIntensity:0}),[.57,.35,-1.30]);
  for(let i=0;i<5;i++)mesh(new THREE.BoxGeometry(.035,.25,.02),mat('#b6a795'),[.4+i*.08,.35,-1.22]);
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
  const observer=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);});observer.observe(container);
  let oldMode='';let oldCoords='';
  function render(sim) {
    sim.positions.forEach((p,i)=>markers[i].position.set(p[0],.31,p[1]));
    const coords=JSON.stringify(sim.positions);if(oldMode!==sim.config.mode||oldCoords!==coords){setCables(sim.positions,sim.config.mode);oldMode=sim.config.mode;oldCoords=coords;}
    sim.plants.forEach((p,i)=>{
      const item=plantGroups[i];const s=.42+p.growth*.7;item.growthGroup.scale.set(s,s,s);
      item.leaves.forEach(({pivot,leaf},j)=>{pivot.rotation.z=-(.15+p.stress*.9);leaf.material.color.set(p.stress>.55?'#9b9d49':'#548e46');});
      item.fruits.forEach(f=>f.visible=p.growth>.45);
      if(item.model){const scale=.22+p.growth*.68;item.model.scale.setScalar(scale);item.model.rotation.z=p.stress*.28;item.model.traverse(obj=>{if(obj.isMesh){for(const m of (Array.isArray(obj.material)?obj.material:[obj.material]))if(m.name.includes('leaf'))m.color.copy(m.userData.originalColor).lerp(new THREE.Color('#ad9c45'),p.stress*.8);}});}
    });
    if(sim.actuators.fan)fanRotor.rotation.z+=.09;heater.material.emissiveIntensity=sim.actuators.heat?.75:0;
    controls.update();renderer.render(scene,camera);
  }
  renderer.domElement.style.cursor='grab';return {render,markers};
}
