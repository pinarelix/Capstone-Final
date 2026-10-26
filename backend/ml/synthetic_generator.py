"""Reproducible isolated synthetic street-week data generator."""
from __future__ import annotations
import argparse, csv, math, random
from datetime import date, timedelta

def generate(streets: list[str], start: date, months: int = 36, seed: int = 179):
    rng = random.Random(seed)
    weeks = math.ceil(months * 30.4375 / 7)
    rates = {s: rng.uniform(.02, .30) for s in streets}
    rows = []
    for w in range(weeks):
        monday = start + timedelta(days=7*w)
        seasonal = 1 + .22 * math.sin((monday.timetuple().tm_yday / 365) * 2 * math.pi)
        for i, street in enumerate(streets):
            prior = rates[street] * seasonal
            if w > weeks * .65 and i % 9 == 0: prior *= 1.35
            recent = rng.poisson(prior) if hasattr(rng, 'poisson') else sum(rng.random() < prior for _ in range(4))
            label = int(rng.random() < min(.85, prior + .025 * min(recent, 4)))
            rows.append({'street_id': street, 'week_start': monday.isoformat(), 'week_end': (monday+timedelta(days=7)).isoformat(),
                         'count_7d': recent, 'count_28d': max(0, recent+rng.randint(0,2)),
                         'count_84d': max(0, recent+rng.randint(0,8)), 'count_182d': max(0, recent+rng.randint(0,18)),
                         'historical_average': round(prior, 5), 'weeks_since_last': rng.randint(0, 30),
                         'month': monday.month, 'street_index': i, 'y': label, 'data_origin': 'synthetic'})
    return rows

def main():
    p = argparse.ArgumentParser(); p.add_argument('--output', required=True); p.add_argument('--seed', type=int, default=179)
    p.add_argument('--start', default='2023-01-02'); p.add_argument('--months', type=int, default=36)
    a = p.parse_args(); streets = [f'Street {i:02d}' for i in range(1, 72)]
    rows = generate(streets, date.fromisoformat(a.start), a.months, a.seed)
    with open(a.output, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=rows[0]); w.writeheader(); w.writerows(rows)
if __name__ == '__main__': main()
