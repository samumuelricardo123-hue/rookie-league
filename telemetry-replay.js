/* Rookie League lap replay — private samples from the existing lap loader. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const canvas=$("telemetryReplayCanvas");if(!canvas)return;
const ctx=canvas.getContext("2d");
let samples=[],frames=[],cursor=0,playing=false,raf=0,last=0,rate=1,duration=0,geometry=null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const fmt=ms=>{ms=Math.max(0,ms);return Math.floor(ms/60000)+":"+String(Math.floor(ms%60000/1000)).padStart(2,"0")+"."+String(Math.floor(ms%1000)).padStart(3,"0")};
const status=t=>{if($("telemetryReplayStatus"))$("telemetryReplayStatus").textContent=t;};
function pause(){playing=false;cancelAnimationFrame(raf);raf=0;last=0;if($("telemetryReplayPlay"))$("telemetryReplayPlay").textContent="▶ Reproduzir";}
function prepare(raw){
 const arr=raw.map(s=>s?.data||s).filter(s=>Number.isFinite(Number(s.position_x))&&Number.isFinite(Number(s.position_z))&&Number.isFinite(Number(s.lap_time_ms)));
 if(arr.length<3)return [];
 const start=num(arr[0].lap_time_ms);let previous=-Infinity;
 return arr.map(s=>({...s,_t:num(s.lap_time_ms)-start})).filter(s=>{if(s._t<previous)return false;previous=s._t;return true;});
}
function resize(){
 const b=canvas.getBoundingClientRect(),w=Math.max(280,Math.round(b.width||800)),h=Math.max(260,Math.round(b.height||420)),dpr=Math.min(2,window.devicePixelRatio||1);
 canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
 const xs=frames.map(s=>num(s.position_x)),zs=frames.map(s=>num(s.position_z));
 if(!xs.length){geometry=null;return;}
 const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
 const pad=32,scale=Math.min((w-pad*2)/Math.max(1,maxX-minX),(h-pad*2)/Math.max(1,maxZ-minZ));
 const left=(w-(maxX-minX)*scale)/2,top=(h-(maxZ-minZ)*scale)/2;
 geometry={w,h,points:frames.map(s=>({x:left+(num(s.position_x)-minX)*scale,y:h-top-(num(s.position_z)-minZ)*scale}))};
}
function locate(ms){
 let lo=0,hi=frames.length-1;
 while(lo<hi){const mid=(lo+hi+1)>>1;if(frames[mid]._t<=ms)lo=mid;else hi=mid-1;}
 return lo;
}
function draw(){
 const w=canvas.width/(Math.min(2,window.devicePixelRatio||1)),h=canvas.height/(Math.min(2,window.devicePixelRatio||1));
 ctx.clearRect(0,0,w,h);ctx.fillStyle="#09130e";ctx.fillRect(0,0,w,h);
 if(!geometry||!frames.length){ctx.fillStyle="#acbcae";ctx.font="14px sans-serif";ctx.fillText("Carregue uma volta com coordenadas para iniciar o replay.",16,35);return;}
 const pts=geometry.points;ctx.lineCap="round";ctx.lineJoin="round";
 ctx.strokeStyle="#365040";ctx.lineWidth=9;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
 ctx.strokeStyle="#a6ff00";ctx.lineWidth=3;ctx.beginPath();pts.slice(0,locate(cursor)+1).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
 const i=locate(cursor),a=frames[i],b=frames[Math.min(i+1,frames.length-1)],pa=pts[i],pb=pts[Math.min(i+1,pts.length-1)];
 const fraction=b._t>a._t?clamp((cursor-a._t)/(b._t-a._t),0,1):0;
 const x=pa.x+(pb.x-pa.x)*fraction,y=pa.y+(pb.y-pa.y)*fraction,angle=Math.atan2(pb.y-pa.y,pb.x-pa.x);
 ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle="#fff";ctx.strokeStyle="#09130e";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(-9,-7);ctx.lineTo(-5,0);ctx.lineTo(-9,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 const lerp=key=>num(a[key])+(num(b[key])-num(a[key]))*fraction;
 $("telemetryReplayTime").textContent=fmt(cursor)+" / "+fmt(duration);
 $("telemetryReplaySpeed").textContent=lerp("speed_kmh").toFixed(1)+" km/h";
 $("telemetryReplayGear").textContent=String(a.gear??"—");
 $("telemetryReplayBrake").textContent=Math.round(clamp(lerp("brake"),0,1)*100)+"%";
 $("telemetryReplayThrottle").textContent=Math.round(clamp(lerp("throttle"),0,1)*100)+"%";
 $("telemetryReplayPosition").textContent=(clamp(lerp("normalized_position"),0,1)*100).toFixed(1)+"%";
 const slider=$("telemetryReplaySeek");slider.value=String(duration?Math.round(cursor/duration*1000):0);
}
function tick(now){
 if(!playing)return;
 if(!document.hidden&&$("telemetry")?.classList.contains("active")){
   if(last)cursor=clamp(cursor+(now-last)*rate,0,duration);
   draw();
   if(cursor>=duration){pause();return;}
 }
 last=now;raf=requestAnimationFrame(tick);
}
window.telemetryLoadReplay=(raw,lap)=>{
 pause();frames=prepare(Array.isArray(raw)?raw:[]);samples=raw||[];cursor=0;duration=frames.length?frames[frames.length-1]._t:0;
 resize();draw();
 const valid=frames.length>10&&duration>0;
 $("telemetryReplayPlay").disabled=!valid;$("telemetryReplaySeek").disabled=!valid;
 status(valid?"Volta "+(lap?.lap_number??"")+" pronta: "+frames.length.toLocaleString("pt-BR")+" amostras. Use Reproduzir ou mova a linha do tempo.":"Esta volta não contém posições e tempos suficientes para replay.");
};
$("telemetryReplayPlay").addEventListener("click",()=>{if(!frames.length||!duration)return;if(playing){pause();return;}if(cursor>=duration)cursor=0;playing=true;last=0;$("telemetryReplayPlay").textContent="⏸ Pausar";raf=requestAnimationFrame(tick);});
$("telemetryReplayReset").addEventListener("click",()=>{pause();cursor=0;draw();});
$("telemetryReplaySeek").addEventListener("input",e=>{pause();cursor=duration*num(e.target.value)/1000;draw();});
$("telemetryReplayRate").addEventListener("change",e=>{rate=clamp(num(e.target.value),0.25,4);});
document.addEventListener("visibilitychange",()=>{if(document.hidden)pause();});
window.addEventListener("resize",()=>{resize();draw();});
resize();draw();
})();