import argparse, csv, json
from collections import Counter
from datetime import date
def main():
  p=argparse.ArgumentParser(); p.add_argument('--input',required=True); p.add_argument('--output',required=True); a=p.parse_args()
  with open(a.input,encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
  dates=[r.get('date') or r.get('incident_date') for r in rows]; streets=[r.get('street_name') or r.get('street_id') for r in rows]
  valid_dates=[d for d in dates if d]; valid_streets=[s for s in streets if s]
  result={'record_count':len(rows),'valid_date_count':len(valid_dates),'valid_date_percent':len(valid_dates)/len(rows) if rows else 0,'valid_street_count':len(valid_streets),'valid_street_percent':len(valid_streets)/len(rows) if rows else 0,'unique_streets':len(set(valid_streets)),'street_counts':Counter(valid_streets),'earliest_date':min(valid_dates) if valid_dates else None,'latest_date':max(valid_dates) if valid_dates else None,'data_origin':rows[0].get('data_origin','unknown') if rows else 'unknown'}
  result['street_counts']=dict(result['street_counts']); open(a.output,'w',encoding='utf-8').write(json.dumps(result,indent=2))
if __name__=='__main__': main()
