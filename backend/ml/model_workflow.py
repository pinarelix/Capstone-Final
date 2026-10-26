"""Monthly candidate workflow guard: never promotes synthetic models."""
import argparse, json
def evaluate(report):
  data=json.load(open(report,encoding='utf-8')); origin=data.get('data_origin'); test=data.get('splits',{}).get('test',{}); eligible=origin=='real' and test.get('sample_count',0)>=100 and test.get('positive_count',0)>=10 and test.get('negative_count',0)>=10 and test.get('f1_score',0)>=.8
  return {'candidate_status':'validated_real' if eligible else ('rejected' if origin!='synthetic' else 'prototype_synthetic'),'promotable':eligible,'reason':'Synthetic models are never eligible for promotion.' if origin=='synthetic' else 'Insufficient validation evidence or quality threshold.'}
def main():
  p=argparse.ArgumentParser(); p.add_argument('--report',required=True); p.add_argument('--output',required=True); a=p.parse_args(); open(a.output,'w',encoding='utf-8').write(json.dumps(evaluate(a.report),indent=2))
if __name__=='__main__': main()
