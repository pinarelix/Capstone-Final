const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PYTHON = process.env.CART_PYTHON || 'python';
const MODEL_DIR = path.resolve(__dirname, 'ml', 'artifacts');
function runPython(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: path.resolve(__dirname, '..'), windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `Python exited ${code}`)));
    if (input) child.stdin.end(JSON.stringify(input));
  });
}

function registerForecastRoutes(app, { pool, authenticate, requireRole, logAudit, locations }) {
  const readRoles = requireRole(['Executive Officer', 'Kagawad', 'Team Leader']);
  const executive = requireRole(['Executive Officer']);
  app.get('/api/forecasts/current', authenticate, readRoles, async (req, res) => {
    try {
      const [runs] = await pool.query(`SELECT r.*, m.model_version, m.algorithm, m.data_origin, m.status validation_status,
        (SELECT COUNT(*) FROM cart_forecast_predictions p WHERE p.forecast_run_id=r.id) street_count,
        (SELECT COUNT(*) FROM cart_forecast_predictions p WHERE p.forecast_run_id=r.id AND p.predicted_label=1) positive_count
        FROM cart_forecast_runs r JOIN cart_model_registry m ON m.id=r.model_id
        WHERE r.run_status='completed' ORDER BY r.forecast_start DESC LIMIT 1`);
      if (!runs.length) return res.json({ available: false, reason: 'No successful forecast run is available.' });
      const [predictions] = await pool.query('SELECT * FROM cart_forecast_predictions WHERE forecast_run_id=? ORDER BY predicted_label DESC, occurrence_probability DESC', [runs[0].id]);
      res.json({ available: true, run: runs[0], predictions });
    } catch (e) { res.status(503).json({ error: 'Forecast storage is not migrated or unavailable.' }); }
  });
  app.get('/api/forecasts/history', authenticate, readRoles, async (req, res) => {
    try { const [rows] = await pool.query(`SELECT r.*,m.model_version,m.data_origin,m.status validation_status FROM cart_forecast_runs r JOIN cart_model_registry m ON m.id=r.model_id ORDER BY r.forecast_start DESC LIMIT 52`); res.json(rows); }
    catch (e) { res.status(503).json({ error: 'Forecast storage unavailable.' }); }
  });
  app.get('/api/forecast-models', authenticate, readRoles, async (req, res) => {
    try { const [rows] = await pool.query('SELECT id,model_version,algorithm,data_origin,training_start,training_end,test_start,test_end,status,created_at,promoted_at FROM cart_model_registry ORDER BY created_at DESC'); res.json(rows); }
    catch (e) { res.status(503).json({ error: 'Forecast model storage unavailable.' }); }
  });
  app.post('/api/forecasts/run', authenticate, executive, async (req, res) => {
    try { await logAudit(req.userId, 'FORECAST_RUN_REQUESTED', 'cart_forecast_runs', null, null, 'Manual forecast requested'); res.status(202).json({ accepted: true, status: 'queued', message: 'Forecast generation requires an approved local model artifact.' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/forecast-models/train', authenticate, executive, async (req, res) => {
    try {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      const dataset = path.join(MODEL_DIR, 'synthetic.csv'), artifact = path.join(MODEL_DIR, 'cart.joblib'), report = path.join(MODEL_DIR, 'evaluation.json');
      await runPython([path.join('backend','ml','synthetic_generator.py'),'--output',dataset,'--seed','179']);
      const output = await runPython([path.join('backend','ml','train_cart.py'),'--dataset',dataset,'--artifact',artifact,'--report',report]);
      const result = JSON.parse(output); await logAudit(req.userId, 'FORECAST_MODEL_TRAINED', 'cart_model_registry', null, null, 'Synthetic prototype trained'); res.status(201).json({ ...result, status: 'prototype_synthetic' });
    } catch (e) { res.status(503).json({ error: 'Training unavailable. Install a supported Python runtime and backend/ml requirements.', detail: e.message }); }
  });
  app.post('/api/forecast-models/:id/promote', authenticate, executive, async (req, res) => res.status(409).json({ error: 'Promotion requires validated real-data evidence; synthetic prototypes cannot be promoted.' }));
}
module.exports = { registerForecastRoutes, runPython };
