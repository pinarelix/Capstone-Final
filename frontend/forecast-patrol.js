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

  // Calendar-side fallback: the legacy recommendation renderer can remain
  // on its loading placeholder when another panel fails during startup.
  // Populate it from the same verified, policy-filtered heatmap records so
  // Decisions never looks empty while the forecast panel is available.
  const calendarPanel = document.getElementById('calendarRiskRecommendations');
  const calendarCount = document.getElementById('calendarRiskCount');
  if (calendarPanel && /Loading risk analysis/i.test(calendarPanel.textContent || '')) {
    try {
      const response = await window.apiFetch('/heatmap/records?window_days=90&limit=500');
      const data = await response.json();
      const groups = {};
      (data.records || []).filter(record => record.eligible !== false && record.street_name).forEach(record => {
        (groups[record.street_name] ||= []).push(record);
      });
      const entries = Object.entries(groups).sort((a,b) => b[1].length - a[1].length).slice(0, 8);
      if (calendarCount) calendarCount.textContent = `${entries.length} areas`;
      calendarPanel.innerHTML = entries.length ? entries.map(([street, records]) => `<article class="calendar-risk-item"><strong>${esc(street)}</strong><span>${records.length} active record${records.length === 1 ? '' : 's'}</span><small>${esc(records[0].danger_level || 'Risk analysis available')}</small></article>`).join('') : '<p>No active records available for this period.</p>';
    } catch (_) { calendarPanel.innerHTML = '<p>Risk analysis is temporarily unavailable. Refresh to retry.</p>'; }
  }
})();
