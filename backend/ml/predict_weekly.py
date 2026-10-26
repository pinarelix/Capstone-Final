import argparse, json, sys
import pandas as pd
import joblib
FEATURES=['street_id','count_7d','count_28d','count_84d','count_182d','historical_average','weeks_since_last','month','street_index']
def main():
    p=argparse.ArgumentParser(); p.add_argument('--artifact',required=True); a=p.parse_args()
    rows=json.load(sys.stdin); model=joblib.load(a.artifact); frame=pd.DataFrame([{k:r[k] for k in FEATURES} for r in rows])
    probs=model.predict_proba(frame)[:,1].tolist(); print(json.dumps([{'probability':p,'label':int(p>=.5)} for p in probs]))
if __name__=='__main__': main()
