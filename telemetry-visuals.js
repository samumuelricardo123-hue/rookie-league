/* Rookie League · visualização de traçado e comparação autorizada (V81) */
(() => {
 "use strict";
 const $ = id => document.getElementById(id);
 let trackSamples=[], trackLap=null, currentHover=-1;
 let approvedChamps=[], currentShares=new Map(), compareData=null;
 const status=(id,msg)=>{const el=$(id);if(el)el.textContent=msg;};
 const safe=s=>typeof esc==="function"?esc(String(s??"")):String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const fmt=ms=>typeof telemetryFmtMs==="function"?telemetryFmtMs(ms):((Number(ms)/1000).toFixed(3)+" s");
 const n=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
 const percent=value=>Math.max(0,Math.min(100,Math.round(n(value)>1?n(value):n(value)*100)));
 const mapCanvas=$("telemetryTrackCanvas");
 const tooltip=$("telemetryTrackPoint");
 const sectorBox=$("telemetrySectorSummary");

 function asPoints(samples){
   return samples.map((s,i)=>({...s,_idx:i,_x:Number(s.position_x),_z:Number(s.position_z)}))
     .filter(s=>Number.isFinite(s._x)&&Number.isFinite(s._z));
 }
 function trackSetup(){
   if(!mapCanvas)return null;
   const bounds=mapCanvas.getBoundingClientRect();
   const w=Math.max(280,Math.round(bounds.width||880)),h=Math.max(280,Math.round(bounds.height||440));
   const ratio=Math.min(window.devicePixelRatio||1,2);
   mapCanvas.width=Math.round(w*ratio);mapCanvas.height=Math.round(h*ratio);
   const ctx=mapCanvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);
   ctx.clearRect(0,0,w,h);
   ctx.fillStyle="#09130e";ctx.fillRect(0,0,w,h);
   const points=asPoints(trackSamples);
   if(points.length<3){ctx.fillStyle="#9aa99e";ctx.font="14px Segoe UI";ctx.fillText("Selecione uma volta com posições gravadas.",18,35);return {points:[],w,h};}
   const xs=points.map(p=>p._x), zs=points.map(p=>p._z);
   const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
   const padding=35,scale=Math.min((w-2*padding)/Math.max(maxX-minX,1),(h-2*padding)/Math.max(maxZ-minZ,1));
   const shiftX=(w-(maxX-minX)*scale)/2,shiftY=(h-(maxZ-minZ)*scale)/2;
   for(const p of points){p.px=shiftX+(p._x-minX)*scale;p.py=h-shiftY-(p._z-minZ)*scale;}
   return {ctx,points,w,h};
 }
 function drawTrack(){
   const data=trackSetup();if(!data||!data.points.length)return;
   const {ctx,points,w,h}=data;
   const speeds=points.map(p=>n(p.speed_kmh));
   const low=Math.min(...speeds), high=Math.max(...speeds), range=Math.max(1,high-low);
   ctx.lineCap="round";ctx.lineJoin="round";
   // Contorno escuro para dar contraste ao desenho do circuito.
   ctx.strokeStyle="#314b38";ctx.lineWidth=11;ctx.beginPath();
   points.forEach((p,i)=>i?ctx.lineTo(p.px,p.py):ctx.moveTo(p.px,p.py));ctx.stroke();
   for(let i=1;i<points.length;i++){
     const a=points[i-1],b=points[i],f=(n(b.speed_kmh)-low)/range;
     ctx.strokeStyle="hsl("+(7+f*112).toFixed(0)+" 92% 52%)";
     ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(a.px,a.py);ctx.lineTo(b.px,b.py);ctx.stroke();
   }
   // Pontos de frenagem fortes, sem sombrear toda a pista.
   for(let i=0;i<points.length;i+=4){
     const p=points[i];if(n(p.brake)>0.35){ctx.fillStyle="#ff5757";ctx.beginPath();ctx.arc(p.px,p.py,3.2,0,Math.PI*2);ctx.fill();}
   }
   const start=points[0];
   ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(start.px,start.py,5.5,0,Math.PI*2);ctx.fill();
   ctx.font="700 12px Segoe UI";ctx.fillText("LARGADA",Math.min(w-80,start.px+9),Math.max(16,start.py-8));
   if(currentHover>=0){
     const p=points.find(x=>x._idx===currentHover);
     if(p){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.px,p.py,9,0,Math.PI*2);ctx.stroke();}
   }
   mapCanvas._trackPoints=points;
 }
 function showHover(i){
   currentHover=i;drawTrack();
   const p=mapCanvas?._trackPoints?.find(x=>x._idx===i);
   if(!p||!tooltip)return;
   tooltip.textContent="Posição "+(n(p.normalized_position)*100).toFixed(1)+"%  ·  "+n(p.speed_kmh).toFixed(1)+" km/h  ·  Freio "+percent(p.brake)+"%  ·  Acelerador "+percent(p.throttle)+"%  ·  Marcha "+(p.gear??"—");
 }
 function sectorSummary(samples){
   if(!sectorBox)return;
   const entries=[];
   for(let i=0;i<samples.length;i++){
     const s=samples[i],sector=Number(s.sector);
     if(!Number.isInteger(sector)||sector<0||sector>2)continue;
     if(!entries.length||entries[entries.length-1].sector!==sector)entries.push({sector,time:n(s.lap_time_ms)});
   }
   const starts=new Map();
   for(const e of entries){if(!starts.has(e.sector))starts.set(e.sector,e.time);}
   const end=n(samples.at(-1)?.lap_time_ms);
   const s1=starts.has(1)?starts.get(1):null,s2=starts.has(2)?starts.get(2):null;
   if(s1!==null&&s2!==null&&s2>s1){
     const values=[s1,s2-s1,end-s2];
     sectorBox.textContent="Setores estimados pelas amostras: S1 "+fmt(values[0])+" · S2 "+fmt(values[1])+" · S3 "+fmt(values[2])+". Não são tempos oficiais.";
   }else{sectorBox.textContent="Setores: o arquivo não possui transições suficientes para estimativas confiáveis.";}
 }
 window.telemetryRenderTrack=(samples,lap)=>{
   trackSamples=Array.isArray(samples)?samples:[];trackLap=lap||null;currentHover=-1;
   if(!trackSamples.length){status("telemetryTrackPoint","Sem coordenadas de pista.");drawTrack();return;}
   const speeds=trackSamples.map(s=>n(s.speed_kmh));
   const maxSpeed=Math.max(...speeds),minSpeed=Math.min(...speeds);
   const braking=trackSamples.filter(s=>n(s.brake)>0.15).length;
   status("telemetryTrackInfo",(trackSamples[0].track||"Pista")+" · "+(trackSamples[0].car||"Carro")+" · "+trackSamples.length.toLocaleString("pt-BR")+" amostras");
   status("telemetryTrackMetrics","Máxima "+maxSpeed.toFixed(1)+" km/h · Mínima "+minSpeed.toFixed(1)+" km/h · Frenagem em "+(100*braking/trackSamples.length).toFixed(1)+"% das amostras");
   status("telemetryTrackPoint","Passe o mouse sobre o traçado para ver velocidade, freio e acelerador.");
   sectorSummary(trackSamples);
   drawTrack();
 };
 if(mapCanvas){
   mapCanvas.addEventListener("mousemove",e=>{
     const pts=mapCanvas._trackPoints;if(!pts?.length)return;
     const b=mapCanvas.getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;
     let best=0,dist=Infinity;
     for(let i=0;i<pts.length;i++){const d=(pts[i].px-x)**2+(pts[i].py-y)**2;if(d<dist){dist=d;best=i;}}
     if(dist<1600&&currentHover!==pts[best]._idx)showHover(pts[best]._idx);
   });
   mapCanvas.addEventListener("mouseleave",()=>{currentHover=-1;drawTrack();});
 }
 window.addEventListener("resize",()=>{if(trackSamples.length&&$("telemetry")?.classList.contains("active"))drawTrack();});
 const champSel=$("telemetryCompareChamp"), referenceSel=$("telemetryCompareReference");
 function approvedOptions(){
   const old=champSel?.value;
   if(!champSel)return;
   champSel.innerHTML=approvedChamps.length?approvedChamps.map(x=>'<option value="'+safe(x.championship_id)+'">'+safe(db.championships.find(c=>String(c.id)===String(x.championship_id))?.name||x.championship_id)+'</option>').join(""):'<option value="">Nenhum campeonato aprovado</option>';
   if(old&&approvedChamps.some(x=>String(x.championship_id)===old))champSel.value=old;
 }
 function shareUI(){
   const entry=currentShares.get(champSel?.value||"");
   const checkbox=$("telemetryCompareShare");
   if(checkbox)checkbox.checked=entry===true;
   status("telemetryShareStatus",entry===true?"Compartilhamento das suas análises ativado para este campeonato.":"Suas análises não estão compartilhadas neste campeonato.");
 }
 function referenceOptions(){
   if(!referenceSel)return;
   const last=referenceSel.value;
   // A interface seleciona a pista; o servidor escolhe as voltas compatíveis.
   const sessions=(typeof telemetrySessionsCache!=="undefined"?telemetrySessionsCache:[]).filter(s=>s.track_name);
   const tracks=[...new Set(sessions.map(s=>String(s.track_name).trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
   referenceSel.innerHTML=tracks.length?tracks.map(track=>'<option value="'+safe(track)+'">'+safe(track)+'</option>').join(""):'<option value="">Nenhuma pista gravada</option>';
   if(tracks.includes(last))referenceSel.value=last;
 }
 async function loadCompareAccess(){
   if(!champSel||!cloudUser){approvedChamps=[];currentShares.clear();approvedOptions();referenceOptions();status("telemetryCompareStatus","Entre na sua conta para acessar a comparação.");return;}
   status("telemetryCompareStatus","Consultando inscrições e permissões…");
   try{
     const [regs,shares]=await Promise.all([
       supabaseClient.from("championship_registrations").select("championship_id,status").eq("user_id",cloudUser.id).eq("status","approved"),
       supabaseClient.from("telemetry_championship_shares").select("championship_id,enabled").eq("user_id",cloudUser.id)
     ]);
     if(regs.error)throw regs.error;if(shares.error)throw shares.error;
     approvedChamps=regs.data||[];currentShares=new Map((shares.data||[]).map(x=>[String(x.championship_id),x.enabled===true]));
     approvedOptions();referenceOptions();shareUI();
     status("telemetryCompareStatus",approvedChamps.length?"Selecione uma pista e clique em COMPARAR.":"Nenhuma inscrição aprovada encontrada na sua conta.");
   }catch(e){status("telemetryCompareStatus","Falha ao consultar permissões: "+(e.message||e));}
 }
 async function changeShare(enabled){
   const champ=champSel?.value,checkbox=$("telemetryCompareShare");
   if(!cloudUser||!approvedChamps.some(x=>String(x.championship_id)===champ)){if(checkbox)checkbox.checked=false;return;}
   if(checkbox)checkbox.disabled=true;
   try{
     const {error}=await supabaseClient.from("telemetry_championship_shares").upsert(
       {championship_id:champ,user_id:cloudUser.id,enabled,updated_at:new Date().toISOString()},
       {onConflict:"championship_id,user_id"}
     );
     if(error)throw error;currentShares.set(champ,enabled);shareUI();
   }catch(e){if(checkbox)checkbox.checked=!enabled;status("telemetryShareStatus","Não foi possível alterar a permissão: "+(e.message||e));}
   finally{if(checkbox)checkbox.disabled=false;}
 }

 function renderChampionshipProfiles(pilots){
   const canvas=$("telemetryChampionshipChart"),legend=$("telemetryChampionshipLegend"),sectors=$("telemetryChampionshipSectors");
   if(!canvas||!legend||!sectors)return;
   const withProfiles=pilots.filter(p=>Array.isArray(p.profile)&&p.profile.some(b=>b.speed_kmh!==null)).slice(0,8);
   legend.textContent=withProfiles.length?withProfiles.length+" piloto(s) com dados derivados disponíveis.":"Ainda não há amostras compartilháveis para esta pista.";
   sectors.innerHTML="";
   const rect=canvas.getBoundingClientRect(),w=Math.max(320,Math.round(rect.width||900)),h=330,dpr=Math.min(window.devicePixelRatio||1,2);
   canvas.width=w*dpr;canvas.height=h*dpr;
   const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);
   ctx.fillStyle="#09130e";ctx.fillRect(0,0,w,h);
   if(!withProfiles.length)return;
   const metric=$("telemetryChampionshipMetric")?.value||"speed_kmh";
   const colors=["#a6ff00","#ffca4a","#5ecbff","#fc7caa","#caa6ff","#ff9868","#9fe3ca","#f5f5f5"];
   const pad={l:55,r:20,t:22,b:34},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
   const base=withProfiles[0].profile;
   const value=(p,i)=>{
     const b=p.profile[i];
     if(!b)return NaN;
     if(metric==="delta"){
       const t=Number(b.time_ms),ref=Number(base[i]?.time_ms);
       return b.time_ms===null||base[i]?.time_ms===null?NaN:(t-ref)/1000;
     }
     return b[metric]===null?NaN:Number(b[metric]);
   };
   const values=withProfiles.flatMap(p=>p.profile.map((_,i)=>value(p,i))).filter(Number.isFinite);
   if(!values.length)return;
   let lo=Math.min(...values),hi=Math.max(...values);
   if(metric==="brake"||metric==="throttle"){lo=0;hi=Math.max(1,hi);}
   if(hi-lo<0.001){lo-=1;hi+=1;}
   const x=i=>pad.l+i/39*pw,y=v=>pad.t+ph-(v-lo)/(hi-lo)*ph;
   ctx.font="12px sans-serif";ctx.lineWidth=1;
   for(let j=0;j<=4;j++){
     const v=lo+(hi-lo)*j/4;ctx.strokeStyle="#284035";ctx.beginPath();ctx.moveTo(pad.l,y(v));ctx.lineTo(w-pad.r,y(v));ctx.stroke();
     ctx.fillStyle="#b5c6b8";ctx.fillText(metric==="delta"?v.toFixed(2)+"s":v.toFixed(metric==="speed_kmh"?0:2),4,y(v)+4);
     ctx.fillText(j*25+"%",pad.l+j*pw/4-10,h-9);
   }
   withProfiles.forEach((p,j)=>{
     ctx.strokeStyle=colors[j%colors.length];ctx.lineWidth=2.5;ctx.beginPath();let drawing=false;
     for(let i=0;i<40;i++){const v=value(p,i);if(!Number.isFinite(v)){drawing=false;continue;}if(!drawing)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));drawing=true;}
     ctx.stroke();
   });
   legend.innerHTML=withProfiles.map((p,i)=>'<span style="color:'+colors[i%colors.length]+'">● '+safe(p.pilot_name)+'</span>').join(" &nbsp; ");
   // Ten 10%-distance mini-sectors, estimated using sampled cumulative time.
   const mini=withProfiles.map(p=>({name:p.pilot_name,values:Array.from({length:10},(_,i)=>{
     const start=i===0?0:p.profile[i*4-1]?.time_ms, end=p.profile[Math.min(39,i*4+3)]?.time_ms;
     if(start===null||start===undefined||end===null||end===undefined)return null;
     const a=Number(start),b=Number(end);
     return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
   })}));
   sectors.innerHTML='<h3>Mini-setores estimados (10 trechos)</h3><div class="tableWrap"><table><thead><tr><th>Piloto</th>'+Array.from({length:10},(_,i)=>'<th>T'+(i+1)+'</th>').join("")+'</tr></thead><tbody>'+mini.map(p=>'<tr><td>'+safe(p.name)+'</td>'+p.values.map(v=>'<td>'+(v===null?"—":(v/1000).toFixed(2)+"s")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
 }
 function renderCompare(data){
   const out=$("telemetryCompareResults");if(!out)return;
   const pilots=Array.isArray(data?.pilots)?data.pilots:[];
   renderChampionshipProfiles(pilots);
   if(!pilots.length){out.innerHTML='<p class="empty">Nenhuma volta comparável disponível. Outros pilotos precisam estar aprovados e autorizar o compartilhamento. A pista e o carro devem coincidir.</p>';return;}
   const sorted=[...pilots].sort((a,b)=>n(a.best_lap_ms,Infinity)-n(b.best_lap_ms,Infinity));
   const leader=Math.min(...sorted.map(p=>n(p.best_lap_ms,Infinity)));
   out.innerHTML='<div class="tableWrap"><table><thead><tr><th>Piloto</th><th>Melhor volta</th><th>Diferença</th><th>Média</th><th>Voltas válidas</th></tr></thead><tbody>'+
     sorted.map(p=>'<tr><td class="driver">'+safe(p.pilot_name||"Piloto")+'</td><td class="count">'+fmt(p.best_lap_ms)+'</td><td>'+(n(p.best_lap_ms)-leader<1?"LÍDER":"+"+((n(p.best_lap_ms)-leader)/1000).toFixed(3)+" s")+'</td><td>'+fmt(p.average_lap_ms)+'</td><td>'+n(p.valid_laps)+'</td></tr>').join("")+
     '</tbody></table></div><p class="telemetryStatus">Tempos por volta obtidos das análises autorizadas. Arquivos brutos dos outros pilotos permanecem privados.</p>';
   const select=$("telemetryComparePilot");if(select){
     select.innerHTML=sorted.map(p=>'<option value="'+safe(p.driver_id)+'">'+safe(p.pilot_name||"Piloto")+'</option>').join("");
     showPilotLaps();
   }
 }
 function showPilotLaps(){
   const selected=$("telemetryComparePilot")?.value,p=compareData?.pilots?.find(x=>String(x.driver_id)===selected),box=$("telemetryComparePilotLaps");
   if(!box)return;if(!p){box.innerHTML="";return;}
   const laps=[...(p.laps||[])].sort((a,b)=>n(a.lap_time_ms)-n(b.lap_time_ms));
   box.innerHTML='<div class="tableWrap"><table><thead><tr><th>Volta</th><th>Tempo</th><th>Setor 1</th><th>Setor 2</th><th>Setor 3</th></tr></thead><tbody>'+laps.map(l=>'<tr><td>'+n(l.lap_number)+'</td><td>'+fmt(l.lap_time_ms)+'</td><td>'+fmt(l.sector1_ms)+'</td><td>'+fmt(l.sector2_ms)+'</td><td>'+fmt(l.sector3_ms)+'</td></tr>').join("")+'</tbody></table></div>';
 }
 async function runComparison(){
   const champ=champSel?.value,reference=referenceSel?.value;
   if(!cloudUser)return status("telemetryCompareStatus","Faça login primeiro.");
   if(!approvedChamps.some(x=>String(x.championship_id)===champ))return status("telemetryCompareStatus","Sua inscrição precisa estar aprovada.");
   if(!reference)return status("telemetryCompareStatus","Selecione uma pista gravada.");
   const btn=$("telemetryCompareRun");if(btn)btn.disabled=true;
   status("telemetryCompareStatus","Consultando análise autorizada…");
   try{
     const {data,error}=await supabaseClient.functions.invoke("telemetry-championship-analysis",{body:{championship_id:champ,track_name:reference}});
     if(error)throw error;
     if(data?.error)throw new Error(data.error);
     compareData=data;renderCompare(data);
     const count=Array.isArray(data?.pilots)?data.pilots.length:0;
     status("telemetryCompareStatus",count+" piloto(s) com voltas comparáveis · mesma pista/configuração e carro.");
   }catch(e){status("telemetryCompareStatus","Não foi possível comparar: "+(e.message||e)+". Confira se a função foi implantada e se a sessão está concluída.");}
   finally{if(btn)btn.disabled=false;}
 }
 champSel?.addEventListener("change",shareUI);
 referenceSel?.addEventListener("change",()=>{compareData=null;});
 $("telemetryCompareShare")?.addEventListener("change",e=>changeShare(e.target.checked));
 $("telemetryCompareRun")?.addEventListener("click",runComparison);
 $("telemetryComparePilot")?.addEventListener("change",showPilotLaps);
 $("telemetryChampionshipMetric")?.addEventListener("change",()=>renderChampionshipProfiles(compareData?.pilots||[]));
 // Carregar opções somente quando a aba é aberta, após autenticação.
 const originalSwitch=window.switchTelemetryTab;
 if(typeof originalSwitch==="function")window.switchTelemetryTab=function(tab){originalSwitch(tab);if(tab==="compare"){loadTelemetrySessions().then(loadCompareAccess).catch(()=>loadCompareAccess());}};
 const originalShow=window.showPage;
 if(typeof originalShow==="function")window.showPage=function(id){originalShow(id);if(id==="telemetry"&&mapCanvas){drawTrack();}};
})();