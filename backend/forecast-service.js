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
    try {
      const artifact = path.join(MODEL_DIR, 'cart.joblib');
      if (!fs.existsSync(artifact)) return res.status(409).json({ error: 'No trained local model is available. Train a model first.' });
      const now = new Date(); const day = now.getUTCDay(); const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7))); const end = new Date(monday.getTime() + 7 * 86400000);
      const iso = d => d.toISOString().slice(0, 10); const rows = locations.map((street, i) => ({ street_id: street, count_7d: 0, count_28d: 0, count_84d: 0, count_182d: 0, historical_average: 0, weeks_since_last: 999, month: monday.getUTCMonth() + 1, street_index: i }));
      const predictions = JSON.parse(await runPython([path.join('backend','ml','predict_weekly.py'),'--artifact',artifact], rows));
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const version = `synthetic-prototype-${iso(monday)}`;
        const [model] = await conn.query(`INSERT INTO cart_model_registry (model_version,algorithm,data_origin,feature_schema_version,artifact_path,artifact_checksum,classification_threshold,status) VALUES (?,?,?,?,?,?,?,'prototype_synthetic') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [version,'CART Decision Tree Classifier','synthetic','cart-weekly-v1',artifact,require('crypto').createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),.5]);
        const modelId = model.insertId; const [run] = await conn.query(`INSERT INTO cart_forecast_runs (model_id,forecast_start,forecast_end,data_cutoff,run_type,run_status,data_origin,created_by) VALUES (?,?,?,?, 'manual','completed','synthetic',?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [modelId,iso(monday),iso(end),now,req.userId]);
        const runId = run.insertId;
        for (let i=0;i<locations.length;i++) await conn.query(`INSERT INTO cart_forecast_predictions (forecast_run_id,street_name,forecast_start,forecast_end,predicted_label,occurrence_probability,decision_threshold,model_id,feature_snapshot,validation_status) VALUES (?,?,?,?,?,?,?,?,?,'prototype_synthetic') ON DUPLICATE KEY UPDATE predicted_label=VALUES(predicted_label),occurrence_probability=VALUES(occurrence_probability),feature_snapshot=VALUES(feature_snapshot)`, [runId,locations[i],iso(monday),iso(end),predictions[i].label,predictions[i].probability,.5,modelId,JSON.stringify(rows[i])]);
        await conn.commit(); await logAudit(req.userId, 'FORECAST_RUN_COMPLETED', 'cart_forecast_runs', runId, null, 'Synthetic prototype forecast generated'); res.status(201).json({ run_id: runId, forecast_start: iso(monday), forecast_end: iso(end), data_origin: 'synthetic', validation_status: 'prototype_synthetic' });
      } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }
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
