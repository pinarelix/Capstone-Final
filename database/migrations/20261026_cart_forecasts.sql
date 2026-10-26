-- Forecast-only storage. Never insert predictions into incident/blotter tables.
CREATE TABLE IF NOT EXISTS cart_model_registry (
  id BIGINT NOT NULL AUTO_INCREMENT, model_version VARCHAR(80) NOT NULL,
  algorithm VARCHAR(120) NOT NULL, data_origin ENUM('synthetic','real') NOT NULL,
  training_start DATE NULL, training_end DATE NULL, validation_start DATE NULL, validation_end DATE NULL,
  test_start DATE NULL, test_end DATE NULL, feature_schema_version VARCHAR(80) NOT NULL,
  artifact_path VARCHAR(500) NOT NULL, artifact_checksum CHAR(64) NOT NULL,
  classification_threshold DECIMAL(8,6) NOT NULL DEFAULT 0.5,
  status ENUM('prototype_synthetic','candidate_real','validated_real','rejected','archived') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, promoted_at TIMESTAMP NULL,
  PRIMARY KEY (id), UNIQUE KEY uq_cart_model_version (model_version), KEY idx_cart_model_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cart_model_evaluations (
  id BIGINT NOT NULL AUTO_INCREMENT, model_id BIGINT NOT NULL, dataset_origin ENUM('synthetic','real') NOT NULL,
  dataset_split ENUM('train','validation','test') NOT NULL, evaluation_start DATE NULL, evaluation_end DATE NULL,
  sample_count INT NOT NULL, positive_count INT NOT NULL, negative_count INT NOT NULL,
  tp INT NOT NULL, tn INT NOT NULL, fp INT NOT NULL, fn INT NOT NULL,
  accuracy DECIMAL(10,6) NULL, precision_score DECIMAL(10,6) NULL, recall DECIMAL(10,6) NULL,
  f1_score DECIMAL(10,6) NULL, average_precision DECIMAL(10,6) NULL, calibration_score DECIMAL(10,6) NULL,
  threshold DECIMAL(8,6) NOT NULL, evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), CONSTRAINT fk_cart_eval_model FOREIGN KEY (model_id) REFERENCES cart_model_registry(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cart_forecast_runs (
  id BIGINT NOT NULL AUTO_INCREMENT, model_id BIGINT NOT NULL, forecast_start DATE NOT NULL, forecast_end DATE NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, data_cutoff DATETIME NOT NULL,
  run_type ENUM('scheduled','manual','evaluation') NOT NULL DEFAULT 'scheduled',
  run_status ENUM('running','completed','failed') NOT NULL DEFAULT 'running', data_origin ENUM('synthetic','real') NOT NULL,
  error_message TEXT NULL, created_by INT NULL, PRIMARY KEY (id), UNIQUE KEY uq_cart_run_week (model_id, forecast_start, run_type),
  CONSTRAINT fk_cart_run_model FOREIGN KEY (model_id) REFERENCES cart_model_registry(id), CONSTRAINT fk_cart_run_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cart_forecast_predictions (
  id BIGINT NOT NULL AUTO_INCREMENT, forecast_run_id BIGINT NOT NULL, street_name VARCHAR(100) NOT NULL,
  forecast_start DATE NOT NULL, forecast_end DATE NOT NULL, predicted_label TINYINT(1) NOT NULL,
  occurrence_probability DECIMAL(10,8) NOT NULL, decision_threshold DECIMAL(8,6) NOT NULL, model_id BIGINT NOT NULL,
  feature_snapshot JSON NOT NULL, validation_status VARCHAR(40) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id), UNIQUE KEY uq_cart_prediction_street (forecast_run_id, street_name),
  CONSTRAINT fk_cart_prediction_run FOREIGN KEY (forecast_run_id) REFERENCES cart_forecast_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_prediction_model FOREIGN KEY (model_id) REFERENCES cart_model_registry(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cart_forecast_outcomes (
  id BIGINT NOT NULL AUTO_INCREMENT, forecast_prediction_id BIGINT NOT NULL, actual_label TINYINT(1) NOT NULL,
  qualifying_record_count INT NOT NULL DEFAULT 0, reporting_complete TINYINT(1) NOT NULL DEFAULT 0,
  observation_finalized_at DATETIME NULL, evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id), UNIQUE KEY uq_cart_outcome_prediction (forecast_prediction_id),
  CONSTRAINT fk_cart_outcome_prediction FOREIGN KEY (forecast_prediction_id) REFERENCES cart_forecast_predictions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
