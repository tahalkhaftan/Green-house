// Isometric canvas fallback keeps the dashboard usable on devices without WebGL.
export function createFallbackScene(container, onMove) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none;cursor:grab';container.append(canvas);
  const c=canvas.getContext('2d'), colors=['#ec7960','#54aec3','#ae8860','#e0b855','#7d91d0'];
  let current=null, drag=null;
  function metrics(){const w=container.clientWidth,h=container.clientHeight;return {w,h,s:Math.min(w/6,h/4.1),cx:w*.5,cy:h*.64};}
  function project(x,y,z){const {s,cx,cy}=metrics();return [cx+(x-z*.62)*s,cy+(.34*x+.34*z-y)*s];}
  function segment(points,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y,z],i)=>{const p=project(x,y,z);i?c.lineTo(...p):c.moveTo(...p)});c.stroke();}
  function poly(points,fill,stroke){c.beginPath();points.forEach(([x,y,z],i)=>{const p=project(x,y,z);i?c.lineTo(...p):c.moveTo(...p)});c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.stroke();}}
  function ellipse(x,y,z,rx,ry,color,rotation=0){const p=project(x,y,z),{s}=metrics();c.fillStyle=color;c.beginPath();c.ellipse(p[0],p[1],rx*s,ry*s,rotation,0,Math.PI*2);c.fill();}
  function render(sim){
    current=sim;const {w,h,s}=metrics(), dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.fillStyle='#e8f0e9';c.fillRect(0,0,w,h);
    poly([[-1.2,0,-1.65],[1.2,0,-1.65],[1.2,0,1.65],[-1.2,0,1.65]],'#c2cfbd');
    poly([[-1,0,-1.5],[-1,1.6,-1.5],[1,1.6,-1.5],[1,0,-1.5]],'rgba(199,231,218,.30)');
    poly([[-1,1.6,-1.5],[0,2,-1.5],[0,2,1.5],[-1,1.6,1.5]],'rgba(222,244,235,.40)');
    for(const x of [-.53,.53])poly([[x-.38,.16,-1.3],[x+.38,.16,-1.3],[x+.38,.16,1.3],[x-.38,.16,1.3]],'#725c48');
    for(const x of [-1,1])for(const z of [-1.5,0,1.5])segment([[x,0,z],[x,1.6,z]],'#9bada0',2);
    for(const z of [-1.5,0,1.5]){segment([[-1,1.6,z],[0,2,z],[1,1.6,z]],'#819c8c',2);}
    for(const x of [-1,1])segment([[x,1.6,-1.5],[x,1.6,1.5]],'#819c8c',2);
    segment([[0,2,-1.5],[0,2,1.5]],'#819c8c',2);
    sim.plants.forEach((p,i)=>{const x=i%2?.53:-.53,z=i<2?-.65:.65,height=.3+p.growth*.8;segment([[x,.16,z],[x,height,z]],'#5c834e',4);for(let j=0;j<5;j++){let a=j%2?1:-1,ly=.28+j*(height-.28)/5, droop=p.stress*.18;segment([[x,ly,z],[x+a*.17,ly+.05-droop,z]],'#638950',2);ellipse(x+a*.22,ly+.05-droop,z,.12,.035,p.stress>.55?'#9b9d49':'#649c55',a*.25+p.stress*.8);}if(p.growth>.45)ellipse(x+.12,height*.55,z,.06,.06,'#d0523d');});
    // Equipment states are tied to the same controller used by the simulation.
    poly([[.3,.22,-1.35],[.76,.22,-1.35],[.76,.54,-1.35],[.3,.54,-1.35]],sim.actuators.heat?'#d96842':'#b7aea0','#8d8c7c');
    for(let b=0;b<4;b++)segment([[.35+b*.1,.26,-1.34],[.35+b*.1,.49,-1.34]],'#e7d3b4',2);
    const fp=project(.98,1.15,-.9);c.beginPath();c.fillStyle='#668578';c.arc(fp[0],fp[1],.2*s,0,2*Math.PI);c.fill();c.strokeStyle=sim.actuators.fan?'#e6f7ef':'#a1b9aa';c.lineWidth=3;c.beginPath();c.moveTo(fp[0]-.13*s,fp[1]);c.lineTo(fp[0]+.13*s,fp[1]);c.moveTo(fp[0],fp[1]-.13*s);c.lineTo(fp[0],fp[1]+.13*s);c.stroke();
    for(const x of [-.52,.52])segment([[x,.3,-1.25],[x,.3,1.25]],sim.actuators.pump?'#398bc1':'#293e35',3);
    ellipse(-.75,.3,-1.3,.12,.10,sim.actuators.cool?'#65b5c1':'#8cb7b6');
    for(let i=0;i<sim.positions.length;i++){let [x,z]=sim.positions[i],p=project(x,.7,z),q=project(x,.2,z);segment([[x,.2,z],[x,.7,z]],'#577268',2);c.beginPath();c.fillStyle=colors[i];c.arc(p[0],p[1],7,0,2*Math.PI);c.fill();c.strokeStyle='white';c.lineWidth=2;c.stroke();}
    poly([[1,.9,.9],[1,1.2,.9],[1,1.2,1.2],[1,.9,1.2]],'#608579');
    c.fillStyle='#789585';c.font='11px Tahoma';c.textAlign='left';c.fillText('نمای جایگزین • WebGL در دسترس نیست',15,metrics().h-48);
  }
  function eventPos(e){const rect=canvas.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];}
  canvas.addEventListener('pointerdown',e=>{if(!current)return;const q=eventPos(e);let best=18;current.positions.forEach(([x,z],i)=>{const p=project(x,.7,z),d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<best){best=d;drag=i;}});if(drag!==null)canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(drag===null)return;const [px,py]=eventPos(e),{s,cx,cy}=metrics();const a=(px-cx)/s,b=(py-cy)/s+.7,z=(b/.34-a)/1.62,x=a+.62*z;onMove(drag,[Math.max(-.9,Math.min(.9,x)),Math.max(-1.35,Math.min(1.35,z))]);});
  const end=()=>drag=null;canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  return {render};
}
