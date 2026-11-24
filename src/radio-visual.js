// Animated samples use the very same delivery probability as the simulation.
// They are a diagram, not the individual five-minute records.
function random01(seed){const x=Math.sin(seed*127.1+51.37)*43758.5453;return x-Math.floor(x);}
export function packetVisual(sensor,index,motion,successChance){
 const position=motion*.45+index/7,cycle=Math.floor(position),phase=position-cycle;
 const seed=(sensor+1)*97+index*31+cycle*233;
 const delivered=random01(seed)<successChance;
 // Failed samples disappear at different points before reaching the controller.
 const lossPoint=.14+.60*random01(seed+17.39);
 return {phase,visible:delivered||phase<lossPoint};
}
