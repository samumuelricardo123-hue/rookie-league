/* Visual comparison: own laps only. Other drivers' private JSONL files are never downloaded. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
let own=[], selectedTrack="", active=[];
const say=t=>{if($("telemetryVisualStatus"))$("telemetryVisualStatus").textContent=t;};
const number=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const format=ms=>(ms/1000).toFixed(3)+" s";
const parse=blob=>blob.text().then(t=>t.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean).map(r=>r.data||r).filter(r=>Number.isFinite(Number(r.normalized_position))));
function sampled(rows){
 const arr=rows.filter(r=>Number.isFinite(Number(r.normalized_position))&&Number.isFinite(Number(r.lap_time_ms)))
 .map(r=>({...r,p:number(r.normalized_position),time:number(r.lap_time_ms)})).filter(r=>r.p>=0&&r.p<=1);
 // A completed lap should progress monotonically; discard wraps and invalid segments.
 const clean=[];let last=-1;
 for(const r of arr){if(r.p+0.005<last)continue;if(r.p>=last){clean.push(r);last=r.p;}}
 return clean;
}
function interp(a,pos,key){
 if(!a.length)return NaN;
 let l=0,h=a.length-1;
 if(pos<a[0].p||pos>a[h].p)return NaN;
 while(h-l>1){const m=(l+h)>>1;if(a[m].p<pos)l=m;else h=m;}
 const x=a[l],y=a[h],span=y.p-x.p;
 const t=span>0?(pos-x.p)/span:0;
 return number(x[key])+(number(y[key])-number(x[key]))*t;
}

function renderInsights(){
 const target=$("telemetryDrivingInsights");if(!target)return;
 if(!active.length){target.textContent="Carregue suas voltas para ver o diagnóstico de pilotagem.";return;}
 const rows=active.map(a=>{
   const samples=a.samples, speeds=samples.map(s=>Number(s.speed_kmh)).filter(Number.isFinite);
   const braking=samples.filter(s=>Number(s.brake)>=0.15);
   const fullThrottle=samples.filter(s=>Number(s.throttle)>=0.9);
   const total=samples.length||1;
   return {lap:a.lap.lap_number,time:a.lap.lap_time_ms,
     top:speeds.length?Math.max(...speeds):null,
     min:speeds.length?Math.min(...speeds):null,
     brake:100*braking.length/total,throttle:100*fullThrottle.length/total};
 });
 const fmt=v=>v===null?"—":v.toFixed(1);
 target.innerHTML='<h3>Diagnóstico de pilotagem · suas voltas</h3>'+
 '<div class="tableWrap"><table><thead><tr><th>Volta</th><th>Tempo</th><th>Velocidade máx.</th><th>Velocidade mín.</th><th>Amostras com freio</th><th>Amostras com acelerador ≥90%</th></tr></thead><tbody>'+
 rows.map(r=>'<tr><td>'+r.lap+'</td><td>'+(r.time/1000).toFixed(3)+' s</td><td>'+fmt(r.top)+' km/h</td><td>'+fmt(r.min)+' km/h</td><td>'+fmt(r.brake)+'%</td><td>'+fmt(r.throttle)+'%</td></tr>').join("")+'</tbody></table></div>'+
 '<p class="telemetryStatus">Percentuais calculados sobre amostras registradas, não sobre o tempo de volta. Servem como indicadores, não como recomendações automáticas de pilotagem.</p>';
}
function draw(){
 const canvas=$("telemetryCompareVisualCanvas");if(!canvas)return;
 const width=Math.max(320,Math.round(canvas.getBoundingClientRect().width||900)),height=380;
 const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=width*ratio;canvas.height=height*ratio;
 const ctx=canvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
 ctx.fillStyle="#09130e";ctx.fillRect(0,0,width,height);
 if(!active.length){ctx.fillStyle="#aab8ac";ctx.font="14px sans-serif";ctx.fillText("Selecione voltas gravadas para comparar.",18,34);return;}
 const mode=$("telemetryVisualMode")?.value||"speed_kmh";
 const pad={left:55,right:20,top:25,bottom:42},pw=width-pad.left-pad.right,ph=height-pad.top-pad.bottom;
 const keys=mode==="delta"?"delta":mode;
 const base=active[0].samples;
 const grid=Array.from({length:201},(_,i)=>i/200);
 const lines=active.map((a,i)=>grid.map(p=>({p,v:keys==="delta"?interp(a.samples,p,"time")-interp(base,p,"time"):interp(a.samples,p,keys)})).filter(x=>Number.isFinite(x.v)));
 let all=lines.flat().map(p=>p.v);
 if(!all.length)return;
 let lo=Math.min(...all),hi=Math.max(...all);if(mode==="throttle"||mode==="brake"){lo=0;hi=Math.max(1,hi);}
 if(hi-lo<0.001){hi+=1;lo-=1;}
 const y=v=>pad.top+ph-(v-lo)/(hi-lo)*ph,x=p=>pad.left+p*pw;
 ctx.strokeStyle="#2c4132";ctx.lineWidth=1;ctx.font="12px sans-serif";ctx.fillStyle="#9aada0";
 for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4;ctx.beginPath();ctx.moveTo(pad.left,y(v));ctx.lineTo(width-pad.right,y(v));ctx.stroke();ctx.fillText(mode==="delta"?(v/1000).toFixed(2)+"s":v.toFixed(mode==="speed_kmh"?0:2),4,y(v)+4);}
 for(let i=0;i<=4;i++){ctx.fillText(i*25+"%",x(i/4)-12,height-13);}
 const colors=["#a6ff00","#ffca4a","#5ecbff","#fc7caa"];
 lines.forEach((line,i)=>{ctx.strokeStyle=colors[i%colors.length];ctx.lineWidth=2.5;ctx.beginPath();line.forEach((p,j)=>j?ctx.lineTo(x(p.p),y(p.v)):ctx.moveTo(x(p.p),y(p.v)));ctx.stroke();});
 if(mode==="delta"){ctx.strokeStyle="#ffffff77";ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(pad.left,y(0));ctx.lineTo(width-pad.right,y(0));ctx.stroke();ctx.setLineDash([]);}
 $("telemetryVisualLegend").innerHTML=active.map((a,i)=>'<span style="color:'+colors[i%colors.length]+'">● Volta '+a.lap.lap_number+' · '+format(a.lap.lap_time_ms)+'</span>').join(" &nbsp; ");
}
async function load(){
 const track=$("telemetryCompareReference")?.value;
 if(!track)return say("Selecione uma pista primeiro.");
 selectedTrack=track;own=[];active=[];
 say("Procurando suas voltas gravadas em "+track+"…");
 try{
  if(!cloudUser)throw Error("Faça login.");
  const {data:sessions,error:e1}=await supabaseClient.from("telemetry_sessions").select("id,track_name,car_name,track_config").eq("user_id",cloudUser.id).eq("track_name",track).limit(100);
  if(e1)throw e1;
  const ids=(sessions||[]).map(s=>s.id);
  if(!ids.length){say("Nenhuma volta gravada nesta pista.");return;}
  const {data:laps,error:e2}=await supabaseClient.from("telemetry_laps").select("id,session_id,lap_number,lap_time_ms,sample_file_path,valid").eq("user_id",cloudUser.id).in("session_id",ids).eq("valid",true).not("sample_file_path","is",null).gte("lap_time_ms",30000).order("lap_time_ms",{ascending:true}).limit(40);
  if(e2)throw e2;
  const sessionById=new Map(sessions.map(s=>[s.id,s]));
  // Never mix car/layout when overlaying curves.
  const first=laps?.[0],ref=first&&sessionById.get(first.session_id);
  own=(laps||[]).filter(l=>{const s=sessionById.get(l.session_id);return s?.car_name===ref?.car_name&&(s?.track_config||"")===(ref?.track_config||"")});
  const select=$("telemetryVisualLaps");
  select.innerHTML=own.map(l=>'<option value="'+l.id+'">Volta '+l.lap_number+' · '+format(l.lap_time_ms)+'</option>').join("");
  if(own.length){select.options[0].selected=true;if(own.length>1)select.options[1].selected=true;}
  say(own.length+" volta(s) com arquivo gravado. Selecione até quatro voltas suas para comparar.");
  await compare();
 }catch(e){say("Erro ao carregar voltas: "+(e.message||e));}
}
async function compare(){
 const ids=[...($("telemetryVisualLaps")?.selectedOptions||[])].map(o=>o.value).slice(0,4);
 active=[];if(!ids.length){draw();renderInsights();return;}
 say("Carregando amostras privadas das suas voltas…");
 try{
  for(const id of ids){
   const lap=own.find(l=>l.id===id);if(!lap)continue;
   const {data,error}=await supabaseClient.storage.from("rookie-telemetry").download(lap.sample_file_path);
   if(error)throw error;
   const samples=sampled(await parse(data));
   if(samples.length>20)active.push({lap,samples});
  }
  draw();renderInsights();say(active.length+" volta(s) exibida(s). Delta relativo à primeira volta selecionada; valores estimados pelas amostras.");
 }catch(e){say("Falha ao abrir amostras: "+(e.message||e));}
}
$("telemetryVisualLoad")?.addEventListener("click",load);
$("telemetryVisualLaps")?.addEventListener("change",compare);
$("telemetryVisualMode")?.addEventListener("change",draw);
window.addEventListener("resize",()=>{if(active.length)draw()});
})();
