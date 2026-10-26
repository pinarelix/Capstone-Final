"""Train/evaluate a genuine sklearn DecisionTreeClassifier chronologically."""
from __future__ import annotations
import argparse, csv, json, hashlib
from pathlib import Path
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, average_precision_score, brier_score_loss
import joblib

FEATURES = ['street_id','count_7d','count_28d','count_84d','count_182d','historical_average','weeks_since_last','month','street_index']
def load(path):
    with open(path, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k in FEATURES[1:]: r[k] = float(r[k])
        r['y'] = int(r['y'])
    return rows
def metrics(y, pred, prob):
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0,1]).ravel()
    return {'sample_count': len(y), 'positive_count': int(sum(y)), 'negative_count': int(len(y)-sum(y)), 'tp':int(tp),'tn':int(tn),'fp':int(fp),'fn':int(fn),
      'accuracy':accuracy_score(y,pred),'precision':precision_score(y,pred,zero_division=0),'recall':recall_score(y,pred,zero_division=0),'f1_score':f1_score(y,pred,zero_division=0),
      'average_precision':average_precision_score(y,prob) if len(set(y)) > 1 else None,'brier_score':brier_score_loss(y,prob)}
def train(rows, artifact, report):
    weeks = sorted({r['week_start'] for r in rows}); a, b = int(len(weeks)*.6), int(len(weeks)*.8)
    parts = [{w:'train', **({'x':0} if False else {})} for w in []]
    split = lambda r: 'train' if r['week_start'] in weeks[:a] else ('validation' if r['week_start'] in weeks[a:b] else 'test')
    tr=[r for r in rows if split(r)=='train']; va=[r for r in rows if split(r)=='validation']; te=[r for r in rows if split(r)=='test']
    numeric=FEATURES[1:]; prep=ColumnTransformer([('street',OneHotEncoder(handle_unknown='ignore'),['street_id']),('num','passthrough',numeric)])
    model=Pipeline([('preprocess',prep),('classifier',DecisionTreeClassifier(criterion='gini',max_depth=6,min_samples_leaf=8,class_weight='balanced',random_state=179))])
    model.fit(pd.DataFrame([{k:r[k] for k in FEATURES} for r in tr]),[r['y'] for r in tr])
    result={'algorithm':'CART Decision Tree Classifier','feature_schema_version':'cart-weekly-v1','data_origin':rows[0].get('data_origin','unknown'),'threshold':.5,'splits':{}}
    for name, part in [('train',tr),('validation',va),('test',te)]:
        y=[r['y'] for r in part]; prob=model.predict_proba(pd.DataFrame([{k:r[k] for k in FEATURES} for r in part]))[:,1]; pred=(prob>=.5).astype(int)
        result['splits'][name]={**metrics(y,pred,prob),'start':part[0]['week_start'],'end':part[-1]['week_end']}
    Path(artifact).parent.mkdir(parents=True,exist_ok=True); joblib.dump(model,artifact)
    result['artifact_sha256']=hashlib.sha256(Path(artifact).read_bytes()).hexdigest(); Path(report).parent.mkdir(parents=True,exist_ok=True); Path(report).write_text(json.dumps(result,indent=2),encoding='utf-8'); return result
def main():
    p=argparse.ArgumentParser(); p.add_argument('--dataset',required=True); p.add_argument('--artifact',required=True); p.add_argument('--report',required=True); a=p.parse_args(); print(json.dumps(train(load(a.dataset),a.artifact,a.report),indent=2))
if __name__=='__main__': main()
