# CART Forecast Architecture

The trained prototype is isolated under `backend/ml` and uses scikit-learn's `DecisionTreeClassifier`. Node remains the application boundary; a future bridge should invoke the Python process with JSON and only load artifacts from the application-managed artifact directory. The existing weighted `cart-engine.js` remains the operational risk baseline.

Data flow: approved records → point-in-time street-week builder → chronological train/validation/test split → fitted preprocessing + decision tree → model registry/evaluation → separate forecast run/prediction/outcome tables → Forecasts UI and optional Risk Map/Patrol links.

Synthetic results must display “Synthetic Prototype — Not Validated on Real Barangay Data”. No forecast is an incident and no forecast creates a patrol automatically.
