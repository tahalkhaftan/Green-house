// Isometric canvas fallback keeps the dashboard usable on devices without WebGL.
export function createFallbackScene(container, onMove) {
  const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none;cursor:grab';container.append(canvas);
  const c=canvas.getContext('2d'), colors=['#ec7960','#54aec3','#ae8860','#e0b855','#7d91d0'];
  let current=null, drag=null, motion=0,fanAngle=0,lastTime=performance.now();
  function metrics(){const w=container.clientWidth,h=container.clientHeight;return {w,h,s:Math.min(w/6,h/4.1),cx:w*.5,cy:h*.64};}
  function project(x,y,z){const {s,cx,cy}=metrics();return [cx+(x-z*.62)*s,cy+(.34*x+.34*z-y)*s];}
  function segment(points,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y,z],i)=>{const p=project(x,y,z);i?c.lineTo(...p):c.moveTo(...p)});c.stroke();}
  function poly(points,fill,stroke){c.beginPath();points.forEach(([x,y,z],i)=>{const p=project(x,y,z);i?c.lineTo(...p):c.moveTo(...p)});c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.stroke();}}
  function ellipse(x,y,z,rx,ry,color,rotation=0){const p=project(x,y,z),{s}=metrics();c.fillStyle=color;c.beginPath();c.ellipse(p[0],p[1],rx*s,ry*s,rotation,0,Math.PI*2);c.fill();}
  function render(sim,running=false){
    const now=performance.now(),dt=Math.min(.05,Math.max(0,(now-lastTime)/1000));lastTime=now;if(running){motion+=dt;if(sim.actuators.fan)fanAngle+=dt*9;}
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
    // Radiant heater with a bright yellow glow while powered.
    if(sim.actuators.heat){const [hx,hy]=project(.52,.40,-1.32);const glow=c.createRadialGradient(hx,hy,2,hx,hy,s*.45);glow.addColorStop(0,'rgba(255,199,61,.65)');glow.addColorStop(1,'rgba(255,199,61,0)');c.fillStyle=glow;c.fillRect(hx-s*.45,hy-s*.45,s*.9,s*.9);}
    poly([[.27,.18,-1.35],[.79,.18,-1.35],[.79,.58,-1.35],[.27,.58,-1.35]],'#858e80','#506455');
    poly([[.32,.25,-1.32],[.74,.25,-1.32],[.74,.50,-1.32],[.32,.50,-1.32]],sim.actuators.heat?'#ffa628':'#373f39','#4a5548');
    for(let b=0;b<5;b++)segment([[.36+b*.075,.27,-1.31],[.36+b*.075,.48,-1.31]],sim.actuators.heat?'#fff09b':'#858679',3);
    const fp=project(.98,1.15,-.9);c.beginPath();c.fillStyle='#435f53';c.arc(fp[0],fp[1],.2*s,0,2*Math.PI);c.fill();c.strokeStyle='#dcece2';c.lineWidth=3;c.save();c.translate(fp[0],fp[1]);c.rotate(fanAngle);c.beginPath();c.moveTo(-.13*s,0);c.lineTo(.13*s,0);c.moveTo(0,-.13*s);c.lineTo(0,.13*s);c.stroke();c.restore();
    for(const x of [-.52,.52]){
      segment([[x,1.47,-1.25],[x,1.47,1.25]],'#4b6c63',3);
      for(const z of [-.72,.72]){
        ellipse(x,1.42,z,.04,.025,'#8ba79d');
        if(sim.actuators.pump&&sim.env.water>0)for(let j=0;j<8;j++){const t=(motion*1.5+j/8)%1,spread=(j%2?1:-1)*.16*t;ellipse(x+spread,1.38-.93*t,z+Math.sin(j*2.4)*.14*t,.017,.024,'#23a8e0');}
      }
      segment([[x,.3,-1.25],[x,.3,1.25]],sim.actuators.pump?'#398bc1':'#293e35',3);
    }
    ellipse(-.75,.3,-1.3,.12,.10,sim.actuators.cool?'#65b5c1':'#8cb7b6');
    // Dashes are an animated diagram, not a physical RF calculation.
    if(sim.config.showWaves&&sim.config.mode==='wireless'&&!sim.config.wirelessBreak){
      if(sim.config.traffic<100&&sim.config.interference<100)for(const [x,z] of sim.positions)for(let j=0;j<7;j++){const t=(motion*.45+j/7)%1,t2=Math.min(1,t+.045);segment([[x+(1.16-x)*t,.81+.44*t+Math.sin(t*Math.PI)*.13,z+(1.22-z)*t],[x+(1.16-x)*t2,.81+.44*t2+Math.sin(t2*Math.PI)*.13,z+(1.22-z)*t2]],'#158fe9',3);}
      const noise=Math.ceil(Math.max(sim.config.interference,sim.config.traffic)*.30);for(let j=0;j<noise;j++){const phase=(motion*.6+j*.137)%1,x=-.9+((j*37)%180)/100,y=.6+((j*13)%80)/100,z=-1.25+phase*2.5;segment([[x,y,z],[x+.08,y+.05,z+.04]],'#e84d4d',3);}
    }
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
