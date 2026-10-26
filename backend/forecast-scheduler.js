// Application-managed scheduler. It only invokes a supplied generator after
// the durable database layer has been migrated; missed runs are reconciled on
// startup by checking the latest completed forecast week.
function manilaParts(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o),{});
}
function startForecastScheduler({ reconcile, intervalMs = 60 * 1000, logger = console }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    const p = manilaParts();
    const monday = p.weekday === 'Mon' && p.hour === '00' && Number(p.minute) >= 5 && Number(p.minute) < 6;
    if (!monday) return;
    running = true;
    try { await reconcile({ reason: 'scheduled', timezone: 'Asia/Manila' }); }
    catch (e) { logger.error('[FORECAST] scheduled reconciliation failed:', e.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  Promise.resolve().then(() => reconcile({ reason: 'startup', timezone: 'Asia/Manila' })).catch(e => logger.warn('[FORECAST] startup reconciliation unavailable:', e.message));
  return () => clearInterval(timer);
}
module.exports = { manilaParts, startForecastScheduler };
