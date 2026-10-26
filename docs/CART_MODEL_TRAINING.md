# CART Model Training

Install the pinned Python dependencies from `backend/ml/requirements.txt`. Generate an isolated 36-month dataset with `python backend/ml/synthetic_generator.py --output backend/ml/artifacts/synthetic.csv --seed 179`, then train with `python backend/ml/train_cart.py --dataset backend/ml/artifacts/synthetic.csv --artifact backend/ml/artifacts/cart.joblib --report backend/ml/artifacts/evaluation.json`.

The split is chronological by complete Monday-start weeks: 60% training, 20% validation, and 20% untouched test. Features are historical counts, recency, month, and registered street identity. Thresholds and hyperparameters are not tuned on the final test period.
