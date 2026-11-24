from pathlib import Path
import csv
import json
import math
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA_URL = 'https://huggingface.co/datasets/Okyanus/greenhouse-sensor-data/resolve/938eb7f272ab85e26ec1cbef11404eaea4cc151b/raw/agc2_reference.csv'
CSV_PATH = ROOT / 'data/raw/agc2_reference.csv'


def get_data():
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_PATH.exists():
        urllib.request.urlretrieve(DATA_URL, CSV_PATH)
    return CSV_PATH


def main():
    rows = []
    with get_data().open(newline='', encoding='utf-8') as file:
        for row in csv.DictReader(file):
            try:
                values = [float(row[name]) for name in ('temperature', 'humidity', 'co2', 'light')]
                if not all(math.isfinite(value) for value in values):
                    continue
                rows.append([row['timestamp'], *values])
            except (ValueError, TypeError, KeyError):
                continue
    if len(rows) < 12 * 24 * 7:
        raise ValueError('Not enough valid source observations for seven days')
    # Preserve one actual five-minute observation each hour. This is an input trace,
    # not a physical model of the user's much smaller greenhouse.
    trace = rows[:12 * 24 * 7:12]
    output = {'source': DATA_URL, 'source_kind': 'republished transformed observations',
              'interval_minutes': 60, 'columns': ['timestamp', 'temperature', 'humidity', 'co2', 'light'],
              'values': trace}
    (ROOT / 'public/trace.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')))
    print(f'Prepared {len(trace)} hourly baseline observations from {len(rows)} valid records')


if __name__ == '__main__':
    main()
