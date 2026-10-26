(async function () {
  const panel = document.getElementById('patrolForecastSummary');
  if (!panel || !window.apiFetch) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  try {
    const response = await window.apiFetch('/forecasts/current'); const data = await response.json();
    if (!data.available) { panel.innerHTML = '<span class="text-muted">No completed weekly forecast is available.</span>'; return; }
    const rows = (data.predictions || []).filter(p => Number(p.predicted_label) === 1).slice(0, 8);
    panel.innerHTML = rows.length ? rows.map(p => `<article class="calendar-risk-item"><strong>${esc(p.street_name)}</strong><span> ${(Number(p.occurrence_probability) * 100).toFixed(1)}% probability · ${esc(p.forecast_start)}–${esc(p.forecast_end)}</span><small>Prototype only — officer review required.</small></article>`).join('') : '<span class="text-muted">No positive forecast recommendations for the current week.</span>';
  } catch (_) { panel.innerHTML = '<span class="text-muted">Forecast recommendations unavailable.</span>'; }
})();
