(async function(){
  const host=document.getElementById('forecastOverlayPanel'); if(!host||!window.apiFetch)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  try{const r=await (await window.apiFetch('/forecasts/current')).json(); if(!r.available){host.innerHTML='<span class="text-muted">No weekly forecast overlay available.</span>';return;} host.innerHTML='<strong>Weekly CART Forecasts</strong><small>Separate from actual incidents and rule-based risk scores · '+esc(r.run.forecast_start)+' – '+esc(r.run.forecast_end)+'</small>'+r.predictions.filter(p=>Number(p.predicted_label)===1).slice(0,10).map(p=>`<div class="forecast-map-row"><span>${esc(p.street_name)}</span><b>${(Number(p.occurrence_probability)*100).toFixed(1)}%</b></div>`).join('');}catch(e){host.textContent='Forecast overlay unavailable.';}
})();
