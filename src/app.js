import { Simulation, SENSOR_NAMES, SENSOR_UNITS, SENSOR_KEYS, forecast } from './simulation.js';
import { createScene } from './scene.js';
import { createFallbackScene } from './fallback.js';

const $ = id => document.getElementById(id);
const fa = (n, digits=0) => Number(n).toLocaleString('fa-IR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const toast = message => { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').classList.remove('show'),2800); };
const [weather, model] = await Promise.all([fetch('/weather-2021-2025.json').then(r=>{if(!r.ok)throw Error('weather');return r.json();}),fetch('/model.json').then(r=>r.ok?r.json():null).catch(()=>null)]);
let sim=new Simulation(weather), running=false, speed=5, lag=0, lastFrame=performance.now(), lastUI=0;
const onMove=(i,pos)=>{sim.positions[i]=pos;};
let scene;
try { scene=createScene($('scene'),onMove); }
catch { scene=createFallbackScene($('scene'),onMove); }
const symbols=['🌡','💧','🪴','☀','◍'];
const initialDate = Date.UTC(weather.start_year,0,1);
function season(minutes){const d=new Date(initialDate+Math.min(minutes,sim.totalMinutes-1)*60000),m=d.getUTCMonth()+1,day=d.getUTCDate();if((m===3&&day>=21)||(m>3&&m<6)||(m===6&&day<21))return 'بهار';if((m===6&&day>=21)||(m>6&&m<9)||(m===9&&day<23))return 'تابستان';if((m===9&&day>=23)||(m>9&&m<12)||(m===12&&day<22))return 'پاییز';return 'زمستان';}
$('metrics').innerHTML=SENSOR_NAMES.map((name,i)=>`<div class="metric"><div class="metric-icon">${symbols[i]}</div><div><div class="metric-name">${name}</div><div class="metric-sub" id="sensor-status-${i}">—</div></div><div class="metric-number"><strong id="sensor-${i}">—</strong><small>${SENSOR_UNITS[i]}</small></div></div>`).join('');
function dateLabel(minutes) {
 return new Intl.DateTimeFormat('fa-IR',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(initialDate+minutes*60000));
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
 const report=sim.summary();$('sim-date').textContent=dateLabel(sim.minutes);$('run-indicator').textContent=sim.finished?(sim.finishReason==='death'?'● پایان آزمایش':`● ${fa(sim.config.years)} سال کامل شد`):(running?'● در حال اجرا':'● متوقف');
 const env=sim.env; $('season').textContent=season(sim.minutes);const days=sim.totalMinutes/1440;$('day-count').textContent=fa(Math.min(days,Math.floor(sim.minutes/1440)+1))+' از '+fa(days);
 $('outside-temp').textContent=fa(env.outsideTemp,1)+' °C';$('outside-radiation').textContent=fa(env.outsideRadiation)+' W/m²';$('wind').textContent=fa(env.wind,1)+' km/h';$('outside-humidity').textContent=fa(env.outsideHumidity)+'٪';$('vpd').textContent=fa(env.vpd,2)+' kPa';$('dli').textContent=fa(env.dailyLight,1)+' mol/m²';$('water').textContent=fa(env.water,1)+' لیتر';$('water-used').textContent=fa(env.waterUsed,1)+' لیتر';$('water-added').textContent=fa(env.waterAdded,1)+' لیتر';$('heater-energy').textContent=fa(env.heaterKwh,1)+' kWh';$('rain').textContent=fa(env.rain,1)+' mm';$('nutrient-ph').textContent=fa(env.rootPH,1);$('nutrient-ec').textContent=fa(env.nutrientEC,1)+' mS/cm';
 $('scene-temp').textContent=fa(env.temp,1)+' °C';$('scene-humidity').textContent=fa(env.humidity)+'٪ هوا';$('scene-soil').textContent=fa(env.soil)+'٪ بستر';$('scene-light').textContent=fa(env.light)+' نور';$('scene-water').textContent=fa(env.water,1)+' لیتر';
 for(let i=0;i<5;i++){
  const received=report.last[i], age=report.age[i], stale=age===null||age>sim.config.sampleMinutes*3;
  $('sensor-'+i).textContent=received===null?'—':fa(received,i===0?1:0);
  $('sensor-status-'+i).textContent=sim.isLinkCut()?'ارتباط کاملاً قطع است':stale?'داده قدیمی یا قطع':`دریافت · ${fa(age)} دقیقه پیش · ${fa(report.lastLatencyMs[i])} ms`;
  $('sensor-status-'+i).style.color=stale?'#c57b5e':'#91a398';
 }
 const stress=sim.plants.reduce((sum,p)=>sum+p.stress,0)/sim.plants.length;
 $('health-value').textContent=fa(100*(1-stress))+'٪';$('plant-state').textContent=sim.finishReason==='death'?'گیاه کشته شد':stress>.35?'علائم پژمردگی':'بوته در حال رشد';
 $('condition-label').textContent=season(sim.minutes);$('plant-detail').textContent=sim.reportCondition();$('growth-status').textContent=sim.getGood()?'رشد با شرایط فعلی مجاز است':'رشد متوقف شده است';
 const predicted=forecast(model,sim.history);
 $('forecast').textContent=predicted===null?(sim.config.sampleMinutes!==5?'نیازمند نمونه‌برداری ۵ دقیقه‌ای':'در انتظار ۴ دادهٔ کامل'):fa(predicted,1)+' °C';
 $('ai-meta').textContent=model?`خطای دادهٔ هلند ${fa(model.test_mae_c,2)} °C؛ برای تهران اعتبارسنجی نشده`:'مدل در انتظار آموزش';
 for(const mode of ['wired','wireless']){
  const v=sim.summary(mode);$(mode+'-rate').textContent=fa(v.ratio,2)+'٪';$(mode+'-bar').style.width=v.ratio+'%';
  $(mode+'-detail').textContent=`${fa(v.delivered)} از ${fa(v.generated)} · تأخیر میانگین ${fa(v.delivered ? v.totalLatencyMs/v.delivered : 0)} ms`;
 }
 const selected=report.age.some(a=>a===null||a>sim.config.sampleMinutes*3);
 $('scene-status').innerHTML=`<i style="background:${selected?'#d08a56':'#70af7d'}"></i><span>${!sim.isFresh(0)&&sim.config.automatic?'دادهٔ دما قطع؛ وضعیت بخاری حفظ شد':selected?'دادهٔ یک سنسور قدیمی است':'آخرین داده‌ها معتبر هستند'}</span>`;
 document.querySelectorAll('[data-act]').forEach(b=>{const on=sim.actuators[b.dataset.act];b.classList.toggle('on',on);b.querySelector('small').textContent=on?'روشن':'خاموش';b.disabled=sim.config.automatic;});
 const overlay=$('finish-overlay');overlay.hidden=!sim.finished;
 if(sim.finished){$('finish-title').textContent=sim.finishReason==='death'?'گیاه کشته شده!!':`${fa(sim.config.years)} سال شبیه‌سازی کامل شد`;$('finish-detail').textContent=sim.finishReason==='death'?`آزمایش متوقف شد · ${sim.deathCause} · روز ${fa(Math.floor(sim.minutes/1440)+1)}`:`داده‌های ${fa(sim.config.years)} سال آب‌وهوا بررسی شدند.`;}
 drawChart();
}
function setRunning(value){running=value;lag=0;lastFrame=performance.now();$('toggle').innerHTML=running?'توقف شبیه‌سازی <span>Ⅱ</span>':'شروع شبیه‌سازی <span>▶</span>';update();}
$('toggle').addEventListener('click',()=>{if(sim.finished){toast('برای آزمایش دوباره، شروع مجدد را بزن');return;}setRunning(!running);});
$('turbo').addEventListener('click',()=>{if(sim.finished){toast('برای آزمایش دوباره، شروع مجدد را بزن');return;}$('speed').value='turbo';speed='turbo';$('turbo').classList.add('active');setRunning(true);});
$('years').addEventListener('change',e=>{const n=Number(e.target.value),limit=(Date.UTC(weather.start_year+n,0,1)-initialDate)/60000;if(sim.minutes>limit){e.target.value=sim.config.years;toast('برای کاهش مدت، ابتدا شبیه‌سازی را دوباره شروع کن');return;}sim.setYears(n);if(sim.finished){running=false;lag=0;$('toggle').innerHTML='پایان آزمایش <span>■</span>';update();}else if(!running){$('toggle').innerHTML='شروع شبیه‌سازی <span>▶</span>';update();}else update();});
function resetRun(){const config={...sim.config};const positions=sim.positions.map(x=>[...x]);sim=new Simulation(weather,config);sim.positions=positions;sim.env.rootPH=Number($('ph').value);sim.env.nutrientEC=Number($('ec').value);lag=0;running=false;$('toggle').innerHTML='شروع شبیه‌سازی <span>▶</span>';update();toast('شبیه‌سازی از ابتدا شروع شد');}
$('reset').addEventListener('click',resetRun);$('restart-overlay').addEventListener('click',resetRun);
$('speed').addEventListener('change',e=>{speed=e.target.value==='turbo'?'turbo':Number(e.target.value);$('turbo').classList.toggle('active',speed==='turbo');lag=0;});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{sim.setMode(b.dataset.mode);sim.history=[];document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));update();}));
for(const key of ['interference','traffic']) $(key).addEventListener('input',e=>{sim.config[key]=Number(e.target.value);$(key+'-value').textContent=fa(e.target.value)+'٪';});
$('wired-break').addEventListener('change',e=>{sim.setLinkCut('wired',e.target.checked);update();});
$('wireless-break').addEventListener('change',e=>{sim.setLinkCut('wireless',e.target.checked);update();});
$('show-waves').addEventListener('change',e=>{sim.config.showWaves=e.target.checked;update();});
$('interval').addEventListener('change',e=>{sim.config.sampleMinutes=Number(e.target.value);sim.history=[];sim.nextSample=sim.minutes+sim.config.sampleMinutes;update();});
$('scenario').addEventListener('change',e=>{sim.config.scenario=e.target.value;update();});
$('automatic').addEventListener('change',e=>{sim.config.automatic=e.target.checked;update();});
$('auto-refill').addEventListener('change',e=>{sim.config.autoRefill=e.target.checked;update();});
$('refill').addEventListener('click',()=>{sim.env.waterAdded+=30-sim.env.water;sim.env.water=30;update();toast('مخزن تا ۳۰ لیتر پر شد');});
for(const [id,key,min,max] of [['ph','rootPH',0,14],['ec','nutrientEC',0,10]])$(id).addEventListener('change',e=>{const value=Number(e.target.value);if(Number.isFinite(value)){sim.env[key]=Math.max(min,Math.min(max,value));e.target.value=sim.env[key];update();}});
$('failure-demo').addEventListener('click',()=>{
 if(sim.finished)resetRun();sim.setMode('wireless');sim.setLinkCut('wireless',false);$('wireless-break').checked=false;sim.config.automatic=true;sim.config.traffic=100;sim.actuators.heat=true;
 const stats=sim.stats.wireless;stats.lastTime=stats.lastTime.map(()=>sim.minutes-sim.config.sampleMinutes*4);
 $('automatic').checked=true;$('traffic').value=100;$('traffic-value').textContent='۱۰۰٪';document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='wireless'));
 setRunning(true);toast('قطع کامل ارتباط؛ بخاری در آخرین وضعیت خود باقی می‌ماند');
});
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
function saveRun(){try{let all=JSON.parse(localStorage.getItem('greenhouse-runs')||'[]');let item=sim.exportResult();item.records=item.records.slice(-500);all.unshift(item);all=all.slice(0,5);while(all.length){try{localStorage.setItem('greenhouse-runs',JSON.stringify(all));toast('اجرای ساعتی در مرورگر ذخیره شد');return;}catch(e){if(all.length===1)throw e;all.pop();}}}catch{toast('فضای ذخیره‌سازی مرورگر کافی نیست؛ فایل JSON را دانلود کن');}}
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
 if(running){
  if(speed==='turbo'){const started=performance.now();do{sim.step(600);}while(!sim.finished&&running&&performance.now()-started<12);}
  else{lag+=elapsed*speed*60/5;const steps=Math.min(80,Math.floor(lag));if(steps){sim.step(steps*5);lag-=steps;}}
  if(sim.finished){running=false;lag=0;$('toggle').innerHTML='پایان آزمایش <span>■</span>';update();$('finish-overlay').scrollIntoView({behavior:'smooth',block:'center'});}
 }
 scene.render(sim,running);if(now-lastUI>200){update();lastUI=now;}requestAnimationFrame(frame);
}
update();requestAnimationFrame(frame);
