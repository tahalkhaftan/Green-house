export const SENSOR_NAMES = ['دما', 'رطوبت هوا', 'رطوبت بستر', 'نور', 'دی‌اکسیدکربن'];
export const SENSOR_UNITS = ['°C', '%', '% حجمی', 'µmol/m²/s', 'ppm'];
export const SENSOR_KEYS = ['temp', 'humidity', 'soil', 'light', 'co2'];
export const DEFAULT_POSITIONS = [[-.72,-.58],[.7,-.55],[-.7,.5],[.67,.5],[0,0]];
export const YEAR_MINUTES = 365*24*60;
const clamp = (n, low, high) => Math.max(low, Math.min(high,n));
const satPressure = t => .6108*Math.exp(17.27*t/(t+237.3)); // kPa; FAO-56
const satDensity = t => 2167*satPressure(t)/(t+273.15); // g/m³
function randomSource(seed) { let state=seed>>>0; return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;}; }
function freshStats(){return {generated:0,delivered:0,retries:0,packetLoss:0,attempts:0,totalLatencyMs:0,maxLatencyMs:0,lastLatencyMs:[null,null,null,null,null],last:[null,null,null,null,null],lastTime:[null,null,null,null,null]};}

/** Exploratory greenhouse energy/water balance; not a calibrated crop model. */
export class Simulation {
 constructor(weather,config={}) {
  const startYear=Number(weather?.start_year??weather?.year),endYear=Number(weather?.end_year??weather?.year);
  const expectedHours=(Date.UTC(endYear+1,0,1)-Date.UTC(startYear,0,1))/3600000;
  if(!weather || !Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear<startYear || !Array.isArray(weather.rows) || weather.rows.length!==expectedHours || weather.rows.some(row=>!Array.isArray(row)||row.length<5||row.some(x=>!Number.isFinite(x)))) throw new Error('دادهٔ ساعتی هواشناسی ناقص یا نامعتبر است.');
  this.weather=weather;this.startYear=startYear;this.availableYears=endYear-startYear+1;
  this.config={mode:'wireless',interference:25,traffic:15,sampleMinutes:5,wiredBreak:false,wirelessBreak:false,showWaves:false,years:1,automatic:true,autoRefill:true,scenario:'normal',...config};
  this.config.years=clamp(Math.trunc(this.config.years)||1,1,Math.min(5,this.availableYears));
  this.totalMinutes=(Date.UTC(startYear+this.config.years,0,1)-Date.UTC(startYear,0,1))/60000;
  this.rng={wired:randomSource(1208),wireless:randomSource(1349)};
  this.positions=DEFAULT_POSITIONS.map(p=>[...p]);this.minutes=0;this.nextSample=0;
  this.env={temp:20,humidity:65,soil:35,co2:420,light:0,vpd:0,water:30,rootPH:6.2,nutrientEC:2.2,waterAdded:0,outsideTemp:weather.rows[0][0],outsideHumidity:weather.rows[0][1],outsideRadiation:weather.rows[0][2],wind:weather.rows[0][3],rain:weather.rows[0][4],dailyLight:0,heaterKwh:0,waterUsed:0};
  this.vapor=satDensity(this.env.temp)*.65;this.env.vpd=satPressure(this.env.temp)*.35;this.env.light=weather.rows[0][2]*.55*2;
  this.actuators={fan:false,pump:false,lamp:false,heat:false,cool:false};
  this.plants=Array.from({length:4},(_,i)=>({growth:.12+i*.012,stress:0}));
  this.stats={wired:freshStats(),wireless:freshStats()};this.records=[];this.history=[];this.recent=[];this.hourly=[];
  this.finished=false;this.finishReason=null;this.deathCause='';this.dailyLightAccumulator=0;this.takeSample();
 }
 baseline(){return this.weather.rows[Math.min(this.weather.rows.length-1,Math.floor(this.minutes/60))];}
 setYears(value){const years=clamp(Math.trunc(Number(value))||1,1,Math.min(5,this.availableYears));this.config.years=years;this.totalMinutes=(Date.UTC(this.startYear+years,0,1)-Date.UTC(this.startYear,0,1))/60000;if(this.finishReason==='completed'&&this.minutes<this.totalMinutes){this.finished=false;this.finishReason=null;}else if(!this.finished&&this.minutes>=this.totalMinutes){this.finished=true;this.finishReason='completed';}}
 isLinkCut(mode=this.config.mode){return mode==='wired'?this.config.wiredBreak:this.config.wirelessBreak;}
 setLinkCut(mode,cut){if(mode!=='wired'&&mode!=='wireless')return;this.config[mode==='wired'?'wiredBreak':'wirelessBreak']=Boolean(cut);if(cut){this.stats[mode].lastTime.fill(null);if(mode===this.config.mode)this.history=[];}}
 getGood(){const e=this.env;return e.temp>=18&&e.temp<=30&&e.humidity>=50&&e.humidity<=80&&e.soil>=25&&e.soil<=55&&e.rootPH>=5.5&&e.rootPH<=6.5&&e.nutrientEC>=2&&e.nutrientEC<=2.5;}
 reportCondition(){const e=this.env;if(e.temp<18||e.temp>30)return 'دمای نامناسب';if(e.humidity<50||e.humidity>80)return 'رطوبت هوای نامناسب';if(e.soil<25||e.soil>55)return 'رطوبت بستر نامناسب';if(e.rootPH<5.5||e.rootPH>6.5)return 'pH محلول نامناسب';if(e.nutrientEC<2||e.nutrientEC>2.5)return 'غلظت محلول نامناسب';return 'شرایط برای رشد مناسب است';}
 setMode(mode){if(mode==='wired'||mode==='wireless')this.config.mode=mode;}
 isFresh(i){const s=this.stats[this.config.mode];return !this.isLinkCut()&&s.lastTime[i]!==null&&this.minutes-s.lastTime[i]<=this.config.sampleMinutes*3;}
 step(minutes=5){const loops=Math.max(0,Math.floor(minutes/5));for(let k=0;k<loops&&!this.finished;k++)this.advanceFiveMinutes();}
 advanceFiveMinutes(){
  if(this.finished)return;
  const e=this.env,raw=this.baseline(),scenario=this.config.scenario;
  e.outsideTemp=raw[0]+(scenario==='heat'?12:scenario==='cold'?-12:0);e.outsideHumidity=raw[1];e.outsideRadiation=raw[2];e.wind=raw[3];e.rain=raw[4];
  if(this.config.automatic){
   const s=this.stats[this.config.mode];
   if(this.isFresh(0)){
    const sunlit=raw[2]>20,heatOn=sunlit?18:16.5,heatOff=sunlit?21:19;
    if(s.last[0]<heatOn)this.actuators.heat=true;else if(s.last[0]>heatOff)this.actuators.heat=false;
    if(s.last[0]>27)this.actuators.fan=true;else if(s.last[0]<25)this.actuators.fan=false;
    if(s.last[0]>29)this.actuators.cool=true;else if(s.last[0]<26)this.actuators.cool=false;
   }
   if(this.isFresh(2)){if(s.last[2]<28)this.actuators.pump=true;else if(s.last[2]>38)this.actuators.pump=false;}
   // Lamp supplements daylight using delivered light data; holds its last state on outage.
   if(this.isFresh(3)){const hour=(this.minutes/60)%24;this.actuators.lamp=hour>=8&&hour<18&&s.last[3]<120;}
  }
  // Water balance (40 L substrate, 30 L reservoir). Chosen rates are model parameters.
  const radiation=raw[2];const vpd=Math.max(0,satPressure(e.temp)*(1-e.humidity/100));
  const evaporation=Math.min(e.soil/100*40, (0.001+0.005*radiation/700+0.0015*vpd)*4*(scenario==='drought'?3:1));
  if(this.config.autoRefill && e.water<4){e.waterAdded+=30-e.water;e.water=30;}
  const irrigated=this.actuators.pump?Math.min(e.water,.32):0;
  const coolingWater=(this.actuators.cool&&this.actuators.fan)?Math.min(Math.max(0,e.water-irrigated),.08):0;
  e.water=Math.max(0,e.water-irrigated-coolingWater);e.waterUsed+=irrigated+coolingWater;
  e.soil=clamp(e.soil+(irrigated-evaporation)/40*100,0,60); // drainage above 60% is discarded
  // Sensible energy: 12 m³ enclosure, effective thermal mass 600 kJ/K,
  // assumed overall heat-loss coefficient 35 W/K; fan moves 300 m³/h.
  const heatLoss=35*(e.temp-e.outsideTemp);
  // Illustrative evaporative cooling of incoming air, capped at 7 °C; use only while water is available.
  const inletTemp=e.outsideTemp-(coolingWater>0?Math.min(7,(100-e.outsideHumidity)*.08):0);
  const fanLoss=this.actuators.fan?100*(e.temp-inletTemp):0;
  const solar=radiation*6*.55*.50;
  const heating=this.actuators.heat?1500:0;
  const lampPower=this.actuators.lamp?80:0;
  e.temp=clamp(e.temp+(solar+heating+lampPower-heatLoss-fanLoss)*300/600000,-20,80);
  e.heaterKwh+=heating*5/60/1000;
  // Water-vapour mixing with outdoor air plus a fraction of modelled transpiration.
  const airChanges=(this.actuators.fan?300:12)/12*5/60;
  const inletRH=coolingWater>0?Math.min(95,e.outsideHumidity+28):e.outsideHumidity;
  const outsideVapor=satDensity(inletTemp)*inletRH/100;
  this.vapor+=(outsideVapor-this.vapor)*(1-Math.exp(-airChanges));
  this.vapor+=evaporation*1000*.65/12;
  this.vapor=clamp(this.vapor,0,satDensity(e.temp));
  e.humidity=clamp(100*this.vapor/satDensity(e.temp),0,100);
  e.vpd=Math.max(0,satPressure(e.temp)*(1-e.humidity/100));
  e.light=Math.max(0,radiation*.55*2+(this.actuators.lamp?150:0));
  e.co2=clamp(e.co2+(420-e.co2)*(1-Math.exp(-airChanges))-(e.light>100?0.5:-0.2),250,1200);
  this.dailyLightAccumulator+=e.light*300/1000000;e.dailyLight=this.dailyLightAccumulator;
  const good=this.getGood();
  for(const plant of this.plants){
   if(good){plant.stress=Math.max(0,plant.stress-.00016);if(e.light>60)plant.growth=Math.min(1,plant.growth+.00009*Math.min(1,e.light/250));}
   else {
    const heat=Math.max(0,e.temp-36)/12,cold=Math.max(0,12-e.temp)/10,dry=Math.max(0,20-e.soil)/15,wet=Math.max(0,e.soil-55)/20;
    const severe=heat+cold+dry+wet;
    plant.stress=clamp(plant.stress+(severe>0?severe*.0011:-.00016),0,1);
   }
  }
  this.minutes+=5;
  if(this.minutes%(24*60)===0)this.dailyLightAccumulator=0;
  if(this.plants.some(p=>p.stress>=1)){this.finished=true;this.finishReason='death';this.deathCause=this.reportCondition();}
  else if(this.minutes>=this.totalMinutes){this.finished=true;this.finishReason='completed';}
  if(!this.finished&&this.minutes>=this.nextSample)this.takeSample();
  if(this.minutes%60===0)this.captureHour();
 }
 takeSample(){
  const measurements=SENSOR_KEYS.map(k=>this.env[k]);
  for(let i=0;i<5;i++)for(const mode of ['wired','wireless']){
   const s=this.stats[mode];s.generated++;
   const d=Math.hypot(...this.positions[i]);
   const p=mode==='wired'?(this.config.wiredBreak?1:.001):((this.config.wirelessBreak||this.config.traffic>=100||this.config.interference>=100)?1:clamp(.005+.58*(this.config.interference/100)**2+.30*(this.config.traffic/100)**2+.025*d,0,.98));
   let success=false,tries=0;
   for(let a=0;a<3;a++){tries++;s.attempts++;if(this.rng[mode]()>=p){success=true;break;}s.packetLoss++;if(a<2)s.retries++;}
   const latency=success?Math.round((mode==='wired'?8:25+.35*this.config.traffic)+(tries-1)*(mode==='wired'?15:30)):null;
   if(success){s.delivered++;s.last[i]=measurements[i];s.lastTime[i]=this.minutes;s.totalLatencyMs+=latency;s.maxLatencyMs=Math.max(s.maxLatencyMs,latency);s.lastLatencyMs[i]=latency;}
   this.records.push({minute:this.minutes,link:mode,sensor:SENSOR_KEYS[i],actual:+measurements[i].toFixed(3),received:success?+measurements[i].toFixed(3):null,attempts:tries,latency_ms:latency,delivered:success});
  }
  if(this.records.length>13000)this.records.splice(0,1000);
  const s=this.stats[this.config.mode];this.recent.push({minute:this.minutes,temp:this.env.temp,humidity:this.env.humidity,soil:this.env.soil,received:s.last[0]});if(this.recent.length>140)this.recent.shift();
  const ids=[0,1,4,3];
  if(ids.every(i=>s.lastTime[i]===this.minutes)&&this.config.sampleMinutes===5){this.history.push(ids.map(i=>s.last[i]));if(this.history.length>4)this.history.shift();}else this.history=[];
  this.nextSample=this.minutes+Math.max(5,this.config.sampleMinutes);
 }
 captureHour(){
  const e=this.env,s=this.stats[this.config.mode],a=this.actuators;
  this.hourly.push([this.minutes,+e.outsideTemp.toFixed(2),+e.temp.toFixed(2),+e.humidity.toFixed(2),+e.soil.toFixed(2),+e.light.toFixed(2),+e.co2.toFixed(2),+e.water.toFixed(2),+e.vpd.toFixed(3),+this.plants[0].growth.toFixed(4),+this.plants[0].stress.toFixed(4),+a.heat,+a.fan,+a.pump,+a.cool,...s.last.map(v=>v===null?null:+v.toFixed(2)),...s.lastTime.map(v=>v===null?null:this.minutes-v)]);
 }
 summary(mode=this.config.mode){const s=this.stats[mode];return {...s,ratio:s.generated?100*s.delivered/s.generated:0,age:s.lastTime.map(t=>t===null?null:this.minutes-t)};}
 exportResult(){return {schema:2,created_at:new Date().toISOString(),weather:{source:this.weather.source,city:this.weather.city,start_year:this.startYear,end_year:this.startYear+this.config.years-1,type:this.weather.type},scenario:{...this.config},sensor_positions:this.positions,simulated_minutes:this.minutes,finish_reason:this.finishReason,env:{...this.env},plants:this.plants,actuators:{...this.actuators},statistics:this.stats,hourly:{columns:['minute','outside_temp_c','inside_temp_c','relative_humidity_pct','substrate_water_pct','ppfd','co2_ppm','reservoir_l','vpd_kpa','growth_index','stress_index','heater_on','fan_on','pump_on','cooler_on','received_temp','received_humidity','received_soil','received_light','received_co2','temp_age_min','humidity_age_min','soil_age_min','light_age_min','co2_age_min'],rows:this.hourly},records:this.records,note:'Weather is historical reanalysis; internal climate, crop survival, packet losses, and rates are uncalibrated exploratory estimates, not measured data.'};}
}
export function forecast(model,history){if(!model||history.length<4)return null;let values=history.slice(-4).flat().map((x,i)=>(x-model.mean[i])/model.std[i]);for(const layer of model.layers)values=layer.weights.map((row,i)=>{let sum=layer.bias[i];for(let j=0;j<row.length;j++)sum+=row[j]*values[j];return layer.activation==='relu'?Math.max(0,sum):sum;});return history.at(-1)[0]+values[0];}
