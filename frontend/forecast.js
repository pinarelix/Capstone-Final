(function () {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let predictions = [];
  function setStatus(label, kind, icon) { const badge = $('statusBadge'); badge.className = `status-badge status-${kind}`; badge.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`; $('status').textContent = label; }
  function renderRows() {
    const query = $('streetFilter').value.trim().toLowerCase(); const mode = $('predictionFilter').value;
    const rows = predictions.filter(p => (!query || String(p.street_name).toLowerCase().includes(query)) && (mode === 'all' || (mode === 'positive' ? Number(p.predicted_label) === 1 : Number(p.predicted_label) === 0)));
    $('forecastRows').innerHTML = rows.length ? rows.map(p => `<tr><td><strong>${esc(p.street_name)}</strong></td><td>${esc(p.forecast_start)} – ${esc(p.forecast_end)}</td><td><span class="prediction-pill ${p.predicted_label ? 'positive' : 'negative'}">${p.predicted_label ? 'Occurrence predicted' : 'No occurrence predicted'}</span></td><td class="probability">${(Number(p.occurrence_probability) * 100).toFixed(1)}%</td><td>${esc(p.model_version || 'CART')}</td></tr>`).join('') : '<tr><td colspan="5" class="table-empty">No streets match this filter.</td></tr>';
  }
  function render(run) {
    $('summary').innerHTML = [['Forecast week', `${run.forecast_start}<br><small>to ${run.forecast_end}</small>`, 'fa-calendar-week'], ['Streets forecasted', run.street_count, 'fa-road'], ['Predicted positive', run.positive_count, 'fa-triangle-exclamation'], ['Active model', run.model_version, 'fa-robot']].map(x => `<div class="forecast-stat"><i class="fa-solid ${x[2]}"></i><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
    renderRows(); setStatus('Forecast ready', 'ready', 'fa-circle-check');
  }
  async function load() {
    setStatus('Loading', 'loading', 'fa-circle-notch fa-spin');
    try { const response = await apiFetch('/api/forecasts/current'); const data = await response.json(); if (!data.available) { setStatus('No forecast yet', 'warning', 'fa-clock'); $('status').textContent = data.reason || 'Run a forecast to populate this page.'; $('forecastRows').innerHTML = '<tr><td colspan="5" class="table-empty"><i class="fa-solid fa-calendar-plus"></i><br><strong>No forecast run yet</strong><br><small>Executive Officers can generate the first weekly prototype forecast.</small></td></tr>'; return; } predictions = data.predictions || []; render(data.run); }
    catch (error) { setStatus('Unavailable', 'error', 'fa-circle-exclamation'); $('forecastRows').innerHTML = '<tr><td colspan="5" class="table-empty">Forecast data could not be loaded. Try refreshing the page.</td></tr>'; }
  }
  $('streetFilter').addEventListener('input', renderRows); $('predictionFilter').addEventListener('change', renderRows);
  $('runForecast').addEventListener('click', async () => { const button = $('runForecast'); button.disabled = true; button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Running…'; try { const response = await apiFetch('/api/forecasts/run', { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Forecast run failed.'); await load(); } catch (error) { setStatus('Run failed', 'error', 'fa-circle-exclamation'); $('status').textContent = error.message; } finally { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-play"></i> Run forecast'; } });
  load();
})();
