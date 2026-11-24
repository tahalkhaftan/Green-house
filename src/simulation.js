export const SENSOR_NAMES = ['دما', 'رطوبت هوا', 'رطوبت بستر', 'نور', 'دی‌اکسیدکربن'];
export const SENSOR_UNITS = ['°C', '%', '% حجمی', 'µmol/m²/s', 'ppm'];
export const SENSOR_KEYS = ['temp', 'humidity', 'soil', 'light', 'co2'];
export const DEFAULT_POSITIONS = [[-.72,-.58],[.7,-.55],[-.7,.5],[.67,.5],[0,0]];
export const YEAR_MINUTES = 365*24*60;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const satPressure=t=>.6108*Math.exp(17.27*t/(t+237.3));
const satDensity=t=>2167*satPressure(t)/(t+273.15);
const ENV_KEYS=['temp','humidity','soil','co2','light','vpd','water','rootPH','nutrientEC','waterAdded','outsideTemp','outsideHumidity','outsideRadiation','wind','rain','dailyLight','heaterKwh','waterUsed','lampKwh','mistUsed','isDay'];
const ACT_KEYS=['fan','pump','lamp','heat','cool','mist'];
const AGG_KEYS=['temp','humidity','soil','light','co2','outsideTemp','outsideHumidity','outsideRadiation','vpd','water','wind','rootPH','nutrientEC'];
const STAT_KEYS=['generated','delivered','retries','packetLoss','attempts','totalLatencyMs','maxLatencyMs','queueDrops'];
const HOURLY_COLUMNS=['minute','outside_temp_c','inside_temp_c','relative_humidity_pct','substrate_water_pct','ppfd','co2_ppm','reservoir_l','vpd_kpa','growth_index','stress_index','heater_on','fan_on','pump_on','cooler_on','received_temp','received_humidity','received_soil','received_light','received_co2','temp_age_min','humidity_age_min','soil_age_min','light_age_min','co2_age_min','lamp_on','fogger_on','outside_humidity_pct','outside_radiation_wm2','wind_kmh','rain_mm','dli','water_used_l','heater_kwh','lamp_kwh','fogger_water_l','daylight'];
function randomSource(seed){let state=seed>>>0;return()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};}
function freshStats(){return {generated:0,delivered:0,retries:0,packetLoss:0,attempts:0,totalLatencyMs:0,maxLatencyMs:0,queueDrops:0,lastLatencyMs:[null,null,null,null,null],last:[null,null,null,null,null],lastTime:[null,null,null,null,null]};}
// Illustrative severity controls, not measured channel occupancy or a calibrated RF model.
export function wirelessSuccessChance(traffic,interference,distance=0){
 const load=clamp(traffic,0,100)/100,noise=clamp(interference,0,100)/100;
 if(load>=1||noise>=1)return 0;
 const busy=load**1.25,attemptError=clamp(.005+.55*noise**2+.025*distance,0,1);
 return (1-busy)*(1-attemptError**3);
}
export function isDaylight(timestamp,latitude=35.6892,longitude=51.389){
 const date=new Date(timestamp),year=date.getUTCFullYear(),day=(timestamp-Date.UTC(year,0,1))/86400000+1;
 const declination=.409*Math.sin(2*Math.PI*(day-81)/365.25),lat=latitude*Math.PI/180;
 const hour=date.getUTCHours()+date.getUTCMinutes()/60,solarNoon=12+(52.5-longitude)/15;
 return Math.sin(lat)*Math.sin(declination)+Math.cos(lat)*Math.cos(declination)*Math.cos((hour-solarNoon)*Math.PI/12)>0;
}

/** Exploratory energy, water and link model. It is not calibrated to the user's greenhouse. */
export class Simulation{
 constructor(weather,config={}){
  const first=Number(weather?.start_year??weather?.year),last=Number(weather?.end_year??weather?.year);
  const expected=(Date.UTC(last+1,0,1)-Date.UTC(first,0,1))/3600000;
  if(!weather||!Number.isInteger(first)||!Number.isInteger(last)||last<first||!Array.isArray(weather.rows)||weather.rows.length!==expected||weather.rows.some(r=>!Array.isArray(r)||r.length<5||r.some(x=>!Number.isFinite(x))))throw Error('دادهٔ ساعتی هواشناسی ناقص یا نامعتبر است.');
  this.weather=weather;this.startYear=first;this.availableYears=last-first+1;
  const defaultDate=this.availableYears>=6?`${first}-03-20`:`${first}-01-01`;
  this.config={mode:'wireless',interference:25,traffic:15,sampleMinutes:5,wiredBreak:false,wirelessBreak:false,showWaves:false,years:1,startDate:defaultDate,automatic:true,autoRefill:true,scenario:'normal',...config};
  this.startTimestamp=Date.parse(this.config.startDate+'T00:00:00Z');
  if(!Number.isFinite(this.startTimestamp)||this.startTimestamp<Date.UTC(first,0,1)||this.startTimestamp>=Date.UTC(first+1,0,1))throw Error('تاریخ کشت خارج از بازهٔ داده‌هاست.');
  this.startOffsetHours=(this.startTimestamp-Date.UTC(first,0,1))/3600000;
  this.config.years=clamp(Math.trunc(this.config.years)||1,1,Math.min(5,this.availableYears-1));
  this.totalMinutes=this.minutesForYears(this.config.years);
  this.rng={wired:randomSource(1208),wireless:randomSource(1349)};this.positions=DEFAULT_POSITIONS.map(p=>[...p]);this.minutes=0;this.nextSample=0;
  const raw=weather.rows[this.startOffsetHours];
  this.env={temp:20,humidity:65,soil:35,co2:420,light:raw[2]*.55*2,vpd:satPressure(20)*.35,water:30,rootPH:6.2,nutrientEC:2.2,waterAdded:0,outsideTemp:raw[0],outsideHumidity:raw[1],outsideRadiation:raw[2],wind:raw[3],rain:raw[4],dailyLight:0,heaterKwh:0,waterUsed:0,lampKwh:0,mistUsed:0,isDay:isDaylight(this.startTimestamp,weather.latitude,weather.longitude)};
  this.vapor=satDensity(this.env.temp)*.65;this.actuators={fan:false,pump:false,lamp:false,heat:false,cool:false,mist:false};
  this.plants=Array.from({length:4},(_,i)=>({growth:.12+i*.012,stress:0}));this.stats={wired:freshStats(),wireless:freshStats()};
  this.records=[];this.history=[];this.recent=[];this.hourly=[];this.frames=[];
  this.aggregate={steps:0,sums:Object.fromEntries(AGG_KEYS.map(k=>[k,0])),min:{},max:{},onMinutes:Object.fromEntries(ACT_KEYS.map(k=>[k,0])),goodMinutes:0,dayMinutes:0,rainMm:0,lightMol:0};
  this.finished=false;this.finishReason=null;this.deathCause='';this.dailyLightAccumulator=0;this.takeSample();this.captureFrame();
 }
 minutesForYears(years){const d=new Date(this.startTimestamp);return (Date.UTC(d.getUTCFullYear()+years,d.getUTCMonth(),d.getUTCDate())-this.startTimestamp)/60000;}
 baseline(){return this.weather.rows[Math.min(this.weather.rows.length-1,this.startOffsetHours+Math.floor(this.minutes/60))];}
 setYears(value){const years=clamp(Math.trunc(Number(value))||1,1,Math.min(5,this.availableYears-1));this.config.years=years;this.totalMinutes=this.minutesForYears(years);if(this.finishReason==='completed'&&this.minutes<this.totalMinutes){this.finished=false;this.finishReason=null;}else if(!this.finished&&this.minutes>=this.totalMinutes){this.finished=true;this.finishReason='completed';}}
 isLinkCut(mode=this.config.mode){return mode==='wired'?this.config.wiredBreak:this.config.wirelessBreak;}
 setLinkCut(mode,cut){if(mode!=='wired'&&mode!=='wireless')return;this.config[mode==='wired'?'wiredBreak':'wirelessBreak']=Boolean(cut);if(cut){this.stats[mode].lastTime.fill(null);if(mode===this.config.mode)this.history=[];}}
 getGood(){const e=this.env;return e.temp>=18&&e.temp<=30&&e.humidity>=50&&e.humidity<=80&&e.soil>=25&&e.soil<=55&&e.rootPH>=5.5&&e.rootPH<=6.5&&e.nutrientEC>=2&&e.nutrientEC<=2.5;}
 reportCondition(){const e=this.env;if(e.temp<18||e.temp>30)return 'دمای نامناسب';if(e.humidity<50||e.humidity>80)return 'رطوبت هوای نامناسب';if(e.soil<25||e.soil>55)return 'رطوبت بستر نامناسب';if(e.rootPH<5.5||e.rootPH>6.5)return 'pH محلول نامناسب';if(e.nutrientEC<2||e.nutrientEC>2.5)return 'غلظت محلول نامناسب';return 'شرایط برای رشد مناسب است';}
 setMode(mode){if(mode==='wired'||mode==='wireless')this.config.mode=mode;}
 isFresh(i){const s=this.stats[this.config.mode];return !this.isLinkCut()&&s.lastTime[i]!==null&&this.minutes-s.lastTime[i]<=this.config.sampleMinutes*3;}
 step(minutes=5){for(let k=0,n=Math.max(0,Math.floor(minutes/5));k<n&&!this.finished;k++)this.advanceFiveMinutes();}
 advanceFiveMinutes(){
  if(this.finished)return;const e=this.env,raw=this.baseline(),scenario=this.config.scenario;
  e.outsideTemp=raw[0]+(scenario==='heat'?12:scenario==='cold'?-12:0);e.outsideHumidity=raw[1];e.outsideRadiation=raw[2];e.wind=raw[3];e.rain=raw[4];
  e.isDay=isDaylight(this.startTimestamp+this.minutes*60000,this.weather.latitude,this.weather.longitude);
  if(this.config.automatic){const s=this.stats[this.config.mode];
   if(this.isFresh(0)){const on=e.isDay?18:16.5,off=e.isDay?21:19;if(s.last[0]<on)this.actuators.heat=true;else if(s.last[0]>off)this.actuators.heat=false;if(s.last[0]>27)this.actuators.fan=true;else if(s.last[0]<25)this.actuators.fan=false;if(s.last[0]>29)this.actuators.cool=true;else if(s.last[0]<26)this.actuators.cool=false;}
   if(this.isFresh(1)){if(s.last[1]<55)this.actuators.mist=true;else if(s.last[1]>72)this.actuators.mist=false;}
   if(this.isFresh(2)){if(s.last[2]<28)this.actuators.pump=true;else if(s.last[2]>38)this.actuators.pump=false;}
   if(this.isFresh(3)){const hour=new Date(this.startTimestamp+this.minutes*60000).getUTCHours();if(hour<6||hour>=22)this.actuators.lamp=false;else if(s.last[3]<180)this.actuators.lamp=true;else if(s.last[3]>360)this.actuators.lamp=false;}
  }
  const radiation=raw[2],vpd=Math.max(0,satPressure(e.temp)*(1-e.humidity/100));
  const evaporation=Math.min(e.soil/100*40,(.001+.005*radiation/700+.0015*vpd)*4*(scenario==='drought'?3:1));
  if(this.config.autoRefill&&e.water<4){e.waterAdded+=30-e.water;e.water=30;}
  const irrigated=this.actuators.pump?Math.min(e.water,.32):0;
  const fog=this.actuators.mist?Math.min(Math.max(0,e.water-irrigated),.025):0;
  const cooling=(this.actuators.cool&&this.actuators.fan)?Math.min(Math.max(0,e.water-irrigated-fog),.08):0;
  e.water=Math.max(0,e.water-irrigated-fog-cooling);e.waterUsed+=irrigated+fog+cooling;e.mistUsed+=fog;
  e.soil=clamp(e.soil+(irrigated-evaporation)/40*100,0,60);
  const inletTemp=e.outsideTemp-(cooling>0?Math.min(7,(100-e.outsideHumidity)*.08):0);
  const heatLoss=35*(e.temp-e.outsideTemp),fanLoss=this.actuators.fan?100*(e.temp-inletTemp):0,solar=radiation*6*.55*.50,heating=this.actuators.heat?1500:0,lampPower=this.actuators.lamp?80:0;
  e.temp=clamp(e.temp+(solar+heating+lampPower-heatLoss-fanLoss)*300/600000,-20,80);e.heaterKwh+=heating/12000;e.lampKwh+=lampPower/12000;
  const changes=(this.actuators.fan?300:12)/12*5/60,inletRH=cooling>0?Math.min(95,e.outsideHumidity+28):e.outsideHumidity,outsideVapor=satDensity(inletTemp)*inletRH/100;
  this.vapor+=(outsideVapor-this.vapor)*(1-Math.exp(-changes));this.vapor+=(evaporation*.65+fog*.75)*1000/12;this.vapor=clamp(this.vapor,0,satDensity(e.temp));
  e.humidity=clamp(100*this.vapor/satDensity(e.temp),0,100);e.vpd=Math.max(0,satPressure(e.temp)*(1-e.humidity/100));e.light=Math.max(0,radiation*.55*2+(this.actuators.lamp?150:0));e.co2=clamp(e.co2+(420-e.co2)*(1-Math.exp(-changes))-(e.light>100?.5:-.2),250,1200);
  this.dailyLightAccumulator+=e.light*300/1000000;e.dailyLight=this.dailyLightAccumulator;
  const good=this.getGood();for(const p of this.plants){if(good){p.stress=Math.max(0,p.stress-.00016);if(e.light>60)p.growth=Math.min(1,p.growth+.00009*Math.min(1,e.light/250));}else{const severe=Math.max(0,e.temp-36)/12+Math.max(0,12-e.temp)/10+Math.max(0,20-e.soil)/15+Math.max(0,e.soil-55)/20;p.stress=clamp(p.stress+(severe>0?severe*.0011:-.00016),0,1);}}
  const agg=this.aggregate;agg.steps++;for(const k of AGG_KEYS){const value=e[k];agg.sums[k]+=value;agg.min[k]=Math.min(agg.min[k]??Infinity,value);agg.max[k]=Math.max(agg.max[k]??-Infinity,value);}for(const k of ACT_KEYS)if(this.actuators[k])agg.onMinutes[k]+=5;if(good)agg.goodMinutes+=5;if(e.isDay)agg.dayMinutes+=5;agg.rainMm+=e.rain/12;agg.lightMol+=e.light*300/1000000;
  this.minutes+=5;e.isDay=isDaylight(this.startTimestamp+this.minutes*60000,this.weather.latitude,this.weather.longitude);if(this.minutes%(24*60)===0){this.dailyLightAccumulator=0;e.dailyLight=0;}
  if(this.plants.some(p=>p.stress>=1)){this.finished=true;this.finishReason='death';this.deathCause=this.reportCondition();}else if(this.minutes>=this.totalMinutes){this.finished=true;this.finishReason='completed';}
  if(!this.finished&&this.minutes>=this.nextSample)this.takeSample();
  if(this.minutes%60===0){this.captureHour();this.captureFrame();}else if(this.finished)this.captureFrame();
 }
 takeSample(){const values=SENSOR_KEYS.map(k=>this.env[k]);
  for(let i=0;i<5;i++)for(const mode of ['wired','wireless']){
   const s=this.stats[mode];s.generated++;const d=Math.hypot(...this.positions[i]),load=clamp(this.config.traffic,0,100)/100;
   const cut=this.isLinkCut(mode),busy=mode==='wireless'&&(load>=1||this.config.interference>=100||this.rng[mode]()<load**1.25);
   const p=mode==='wired'?.001:clamp(.005+.55*(this.config.interference/100)**2+.025*d,0,1);let success=false,tries=0;
   if(cut||busy){s.queueDrops++;s.packetLoss++;}else for(let a=0;a<3;a++){tries++;s.attempts++;if(this.rng[mode]()>=p){success=true;break;}s.packetLoss++;if(a<2)s.retries++;}
   const latency=success?Math.round((mode==='wired'?8:25+.35*this.config.traffic)+(tries-1)*(mode==='wired'?15:30)):null;
   if(success){s.delivered++;s.last[i]=values[i];s.lastTime[i]=this.minutes;s.totalLatencyMs+=latency;s.maxLatencyMs=Math.max(s.maxLatencyMs,latency);s.lastLatencyMs[i]=latency;}
   this.records.push({minute:this.minutes,link:mode,sensor:SENSOR_KEYS[i],actual:+values[i].toFixed(3),received:success?+values[i].toFixed(3):null,attempts:tries,latency_ms:latency,delivered:success});
  }
  if(this.records.length>13000)this.records.splice(0,1000);const s=this.stats[this.config.mode];this.recent.push({minute:this.minutes,temp:this.env.temp,humidity:this.env.humidity,soil:this.env.soil,received:s.last[0]});if(this.recent.length>140)this.recent.shift();
  const ids=[0,1,4,3];if(ids.every(i=>s.lastTime[i]!==null&&this.minutes-s.lastTime[i]<=5)&&this.config.sampleMinutes===5){this.history.push(ids.map(i=>s.last[i]));if(this.history.length>12)this.history.shift();}else this.history=[];this.nextSample=this.minutes+Math.max(5,this.config.sampleMinutes);
 }
 captureHour(){const e=this.env,s=this.stats[this.config.mode],a=this.actuators;this.hourly.push([this.minutes,+e.outsideTemp.toFixed(2),+e.temp.toFixed(2),+e.humidity.toFixed(2),+e.soil.toFixed(2),+e.light.toFixed(2),+e.co2.toFixed(2),+e.water.toFixed(2),+e.vpd.toFixed(3),+this.plants[0].growth.toFixed(4),+this.plants[0].stress.toFixed(4),+a.heat,+a.fan,+a.pump,+a.cool,...s.last.map(v=>v===null?null:+v.toFixed(2)),...s.lastTime.map(v=>v===null?null:this.minutes-v),+a.lamp,+a.mist,+e.outsideHumidity.toFixed(2),+e.outsideRadiation.toFixed(2),+e.wind.toFixed(2),+e.rain.toFixed(2),+e.dailyLight.toFixed(3),+e.waterUsed.toFixed(3),+e.heaterKwh.toFixed(3),+e.lampKwh.toFixed(3),+e.mistUsed.toFixed(3),+e.isDay]);}
 captureFrame(){const s=this.stats[this.config.mode];this.frames.push({m:this.minutes,e:ENV_KEYS.map(k=>this.env[k]),a:ACT_KEYS.map(k=>+this.actuators[k]),p:this.plants.flatMap(p=>[p.growth,p.stress]),c:[this.config.mode,this.config.interference,this.config.traffic,+this.config.wiredBreak,+this.config.wirelessBreak,+this.config.showWaves,this.config.sampleMinutes,+this.config.automatic,+this.config.autoRefill,this.config.scenario],pos:this.positions.flat(),last:[...s.last],times:[...s.lastTime],latency:[...s.lastLatencyMs],w:STAT_KEYS.map(k=>this.stats.wired[k]),r:STAT_KEYS.map(k=>this.stats.wireless[k])});}
 replayAt(index){const f=this.frames[clamp(Math.trunc(index)||0,0,this.frames.length-1)];if(!f)return this;const v=Object.assign(Object.create(Simulation.prototype),this);v.minutes=f.m;v.env=Object.fromEntries(ENV_KEYS.map((k,i)=>[k,f.e[i]]));v.actuators=Object.fromEntries(ACT_KEYS.map((k,i)=>[k,!!f.a[i]]));v.plants=Array.from({length:4},(_,i)=>({growth:f.p[2*i],stress:f.p[2*i+1]}));v.config={...this.config,mode:f.c[0],interference:f.c[1],traffic:f.c[2],wiredBreak:!!f.c[3],wirelessBreak:!!f.c[4],showWaves:!!f.c[5],sampleMinutes:f.c[6],automatic:!!f.c[7],autoRefill:!!f.c[8],scenario:f.c[9]};v.positions=Array.from({length:5},(_,i)=>[f.pos[i*2],f.pos[i*2+1]]);v.stats={wired:{...freshStats(),...Object.fromEntries(STAT_KEYS.map((k,i)=>[k,f.w[i]]))},wireless:{...freshStats(),...Object.fromEntries(STAT_KEYS.map((k,i)=>[k,f.r[i]]))}};const chosen=v.stats[v.config.mode];chosen.last=[...f.last];chosen.lastTime=[...f.times];chosen.lastLatencyMs=[...f.latency];v.history=[];v.finished=false;v.finishReason=null;return v;}
 summary(mode=this.config.mode){const s=this.stats[mode];return {...s,ratio:s.generated?100*s.delivered/s.generated:0,age:s.lastTime.map(t=>t===null?null:this.minutes-t)};}
 totalReport(){const a=this.aggregate,n=a.steps;return {minutes:this.minutes,samples:n,average:Object.fromEntries(AGG_KEYS.map(k=>[k,n?a.sums[k]/n:null])),min:a.min,max:a.max,onMinutes:a.onMinutes,goodMinutes:a.goodMinutes,dayMinutes:a.dayMinutes,rainMm:a.rainMm,averageDli:this.minutes?a.lightMol/(this.minutes/1440):null,waterUsed:this.env.waterUsed,mistUsed:this.env.mistUsed,heaterKwh:this.env.heaterKwh,lampKwh:this.env.lampKwh,wired:this.summary('wired'),wireless:this.summary('wireless')};}
 exportResult(){return {schema:3,created_at:new Date().toISOString(),weather:{source:this.weather.source,city:this.weather.city,start:this.config.startDate,type:this.weather.type},scenario:{...this.config},sensor_positions:this.positions,simulated_minutes:this.minutes,finish_reason:this.finishReason,env:{...this.env},plants:this.plants,actuators:{...this.actuators},statistics:this.stats,totals:this.totalReport(),hourly:{columns:HOURLY_COLUMNS,rows:this.hourly},replay_frames:this.frames,records:this.records,note:'Weather is historical reanalysis; greenhouse, crop and packet losses use illustrative models not calibrated to a real greenhouse.'};}
}
export function forecast(model,history){
 if(!model)return null;
 function run(net){const length=net.history_length||4;if(history.length<length)return null;let values=history.slice(-length).flat().map((x,i)=>(x-net.mean[i])/net.std[i]);for(const layer of net.layers)values=layer.weights.map((row,i)=>{let sum=layer.bias[i];for(let j=0;j<row.length;j++)sum+=row[j]*values[j];return layer.activation==='relu'?Math.max(0,sum):sum;});return values;}
 if(model.temperature_model&&model.humidity_model){const t=run(model.temperature_model);if(!t)return null;const h=run(model.humidity_model),net=model.humidity_model;return {temp:history.at(-1)[0]+t[0],humidity:h?history.at(-1)[1]+h[net.output_index]*net.target_std[net.output_index]+net.target_mean[net.output_index]:null};}
 const values=run(model);if(!values)return null;if(model.target_std)return {temp:history.at(-1)[0]+values[0]*model.target_std[0]+model.target_mean[0],humidity:history.at(-1)[1]+values[1]*model.target_std[1]+model.target_mean[1]};return history.at(-1)[0]+values[0];
}
