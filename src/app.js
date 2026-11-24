import { Simulation, SENSOR_NAMES, SENSOR_UNITS, SENSOR_KEYS, forecast } from './simulation.js';
import { createScene } from './scene.js';
import { createFallbackScene } from './fallback.js';

const $ = id => document.getElementById(id);
const fa = (n, digits=0) => Number(n).toLocaleString('fa-IR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const toast = message => { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').classList.remove('show'),2800); };
const [trace, model] = await Promise.all([fetch('/trace.json').then(r=>{if(!r.ok)throw Error('trace');return r.json();}),fetch('/model.json').then(r=>r.ok?r.json():null).catch(()=>null)]);
let sim=new Simulation(trace), running=false, speed=5, lag=0, lastFrame=performance.now(), lastUI=0;
const onMove=(i,pos)=>{sim.positions[i]=pos;};
let scene;
try { scene=createScene($('scene'),onMove); }
catch { scene=createFallbackScene($('scene'),onMove); }
const symbols=['♨','◉','◌','☼','◍'];
const initialDate = new Date(trace.values[0][0].replace(' ','T').slice(0,23)+'Z').getTime();
$('metrics').innerHTML=SENSOR_NAMES.map((name,i)=>`<div class="metric"><div class="metric-icon">${symbols[i]}</div><div><div class="metric-name">${name}</div><div class="metric-sub" id="sensor-status-${i}">—</div></div><div class="metric-number"><strong id="sensor-${i}">—</strong><small>${SENSOR_UNITS[i]}</small></div></div>`).join('');
function dateLabel(minutes) {
 return new Intl.DateTimeFormat('fa-IR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(initialDate+minutes*60000));
}
function drawChart(){
 const canvas=$('chart'), rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2), w=Math.max(10,rect.width),h=Math.max(10,rect.height);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
 const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.strokeStyle='#eaf0e9';c.lineWidth=1;
 for(let i=0;i<4;i++){let y=12+(h-25)*i/3;c.beginPath();c.moveTo(25,y);c.lineTo(w-8,y);c.stroke();}
 const points=sim.recent;if(points.length<2)return;
 const path=(key,color,max)=>{c.beginPath();c.strokeStyle=color;c.lineWidth=2.2;c.lineJoin='round';for(let i=0;i<points.length;i++){let x=26+(w-37)*i/(points.length-1), y=h-12-Math.min(max,Math.max(0,points[i][key]))/max*(h-25);i?c.lineTo(x,y):c.moveTo(x,y)}c.stroke()};
 path('temp','#c97e5e',50);path('soil','#7ba77a',100);
}
function update(){
 const report=sim.summary();$('sim-date').textContent=dateLabel(sim.minutes);$('run-indicator').textContent=running?'● در حال اجرا':'● متوقف';
 for(let i=0;i<5;i++){
  const received=report.last[i], age=report.age[i], stale=age===null||age>sim.config.sampleMinutes*3;
  $('sensor-'+i).textContent=received===null?'—':fa(received,i===0?1:0);
  $('sensor-status-'+i).textContent=stale?'داده قدیمی یا قطع':`دریافت · ${fa(age)} دقیقه پیش · ${fa(report.lastLatencyMs[i])} ms`;
  $('sensor-status-'+i).style.color=stale?'#c57b5e':'#91a398';
 }
 const stress=sim.plants.reduce((sum,p)=>sum+p.stress,0)/sim.plants.length;
 $('health-value').textContent=fa(100*(1-stress))+'٪';$('plant-state').textContent=stress>.35?'علائم پژمردگی':'بوته در حال رشد';
 $('plant-detail').textContent=sim.reportCondition();$('growth-status').textContent=sim.getGood()?'رشد با شرایط فعلی مجاز است':'رشد متوقف شده است';
 const predicted=forecast(model,sim.history);
 $('forecast').textContent=predicted===null?(sim.config.sampleMinutes!==5?'نیازمند نمونه‌برداری ۵ دقیقه‌ای':'در انتظار ۴ دادهٔ کامل'):fa(predicted,1)+' °C';
 $('ai-meta').textContent=model?`خطای آزمایش دادهٔ تاریخی ${fa(model.test_mae_c,2)} °C`:'مدل در انتظار آموزش';
 for(const mode of ['wired','wireless']){
  const v=sim.summary(mode);$(mode+'-rate').textContent=fa(v.ratio,1)+'٪';$(mode+'-bar').style.width=v.ratio+'%';
  $(mode+'-detail').textContent=`${fa(v.delivered)} از ${fa(v.generated)} · تأخیر میانگین ${fa(v.delivered ? v.totalLatencyMs/v.delivered : 0)} ms`;
 }
 const selected=report.age.some(a=>a===null||a>sim.config.sampleMinutes*3);
 $('scene-status').innerHTML=`<i style="background:${selected?'#d08a56':'#70af7d'}"></i><span>${selected?'دادهٔ یک سنسور قدیمی است':'آخرین داده‌ها معتبر هستند'}</span>`;
 document.querySelectorAll('[data-act]').forEach(b=>{const on=sim.actuators[b.dataset.act];b.classList.toggle('on',on);b.querySelector('small').textContent=on?'روشن':'خاموش';b.disabled=sim.config.automatic && ['fan','pump'].includes(b.dataset.act);});
 drawChart();
}
$('toggle').addEventListener('click',()=>{running=!running;lastFrame=performance.now();$('toggle').innerHTML=running?'توقف شبیه‌سازی <span>Ⅱ</span>':'شروع شبیه‌سازی <span>▶</span>';update();});
$('reset').addEventListener('click',()=>{const config={...sim.config};const positions=sim.positions.map(x=>[...x]);sim=new Simulation(trace,config);sim.positions=positions;lag=0;update();toast('شبیه‌سازی از ابتدا شروع شد');});
$('speed').addEventListener('change',e=>{speed=Number(e.target.value);});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{sim.setMode(b.dataset.mode);sim.history=[];document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));update();}));
for(const key of ['interference','traffic']) $(key).addEventListener('input',e=>{sim.config[key]=Number(e.target.value);$(key+'-value').textContent=fa(e.target.value)+'٪';});
$('wired-break').addEventListener('change',e=>{sim.config.wiredBreak=e.target.checked;});
$('interval').addEventListener('change',e=>{sim.config.sampleMinutes=Number(e.target.value);sim.history=[];sim.nextSample=sim.minutes+sim.config.sampleMinutes;update();});
$('scenario').addEventListener('change',e=>{sim.config.scenario=e.target.value;update();});
$('automatic').addEventListener('change',e=>{sim.config.automatic=e.target.checked;update();});
document.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{sim.actuators[b.dataset.act]=!sim.actuators[b.dataset.act];update();}));
$('show-packets').addEventListener('click',()=>{
 const body=$('packet-rows');body.replaceChildren();
 sim.records.filter(r=>r.link===sim.config.mode).slice(-60).reverse().forEach(r=>{
  const tr=document.createElement('tr'), index=SENSOR_KEYS.indexOf(r.sensor);
  for(const value of [dateLabel(r.minute),SENSOR_NAMES[index],fa(r.actual,1),r.delivered?fa(r.received,1):'نرسیده',fa(r.attempts),r.latency_ms===null?'—':fa(r.latency_ms)+' ms']){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
 });$('packet-dialog').showModal();
});
$('close-packets').addEventListener('click',()=>$('packet-dialog').close());
$('show-info').addEventListener('click',()=>$('info-dialog').showModal());$('close-info').addEventListener('click',()=>$('info-dialog').close());
function saveRun(){try{let all=JSON.parse(localStorage.getItem('greenhouse-runs')||'[]');let item=sim.exportResult();item.records=item.records.slice(-2000);all.unshift(item);localStorage.setItem('greenhouse-runs',JSON.stringify(all.slice(0,5)));toast('این اجرا در مرورگر ذخیره شد');}catch{toast('فضای ذخیره‌سازی مرورگر کافی نیست');}}
$('save').addEventListener('click',saveRun);
$('saved').addEventListener('click',()=>{
 const list=$('saved-list');list.replaceChildren();const items=JSON.parse(localStorage.getItem('greenhouse-runs')||'[]');
 if(!items.length){list.textContent='هنوز اجرایی ذخیره نشده است.';}
 items.forEach((item,i)=>{const row=document.createElement('div');row.className='saved-row';const text=document.createElement('span');text.textContent=`${i+1}. ${new Date(item.created_at).toLocaleString('fa-IR')} · ${fa(item.simulated_minutes)} دقیقه`;const b=document.createElement('button');b.textContent='دریافت';b.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(item,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`green-house-saved-${i+1}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};row.append(text,b);list.append(row);});$('saved-dialog').showModal();
});
$('close-saved').addEventListener('click',()=>$('saved-dialog').close());
$('export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(sim.exportResult(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`green-house-run-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('فایل نتیجه آماده شد');});
function frame(now){
 const elapsed=Math.min(.25,(now-lastFrame)/1000);lastFrame=now;
 if(running){lag+=elapsed*speed*60/5;const steps=Math.min(80,Math.floor(lag));if(steps){sim.step(steps*5);lag-=steps;}}
 scene.render(sim);if(now-lastUI>200){update();lastUI=now;}requestAnimationFrame(frame);
}
update();requestAnimationFrame(frame);
