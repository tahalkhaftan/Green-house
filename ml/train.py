"""Fit a temperature forecaster to historical greenhouse sensor readings."""
from pathlib import Path
from datetime import datetime, timezone
import csv
import json
import math
import random
import sys

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare import get_data, DATA_URL

ROOT = Path(__file__).resolve().parents[1]
random.seed(42)
torch.manual_seed(42)
torch.set_num_threads(2)


def read_samples():
    values, times = [], []
    with get_data().open(newline='', encoding='utf-8') as file:
        for row in csv.DictReader(file):
            try:
                datum = [float(row[k]) for k in ('temperature', 'humidity', 'co2', 'light')]
                timestamp = datetime.fromisoformat(row['timestamp'].strip()[:26]).replace(tzinfo=timezone.utc).timestamp()
                if not all(math.isfinite(x) for x in datum):
                    continue
                if not (-10 <= datum[0] <= 60 and 0 <= datum[1] <= 100 and 0 <= datum[2] <= 10000 and 0 <= datum[3] <= 4000):
                    continue
                values.append(datum)
                times.append(timestamp)
            except (ValueError, KeyError, TypeError):
                continue
    features, target, current = [], [], []
    for i in range(3, len(values) - 12):
        if any(not 240 <= times[j + 1] - times[j] <= 360 for j in range(i - 3, i + 12)):
            continue
        features.append([x for sample in values[i - 3:i + 1] for x in sample])
        current.append(values[i][0])
        target.append(values[i + 12][0] - values[i][0])
    if len(features) < 1000:
        raise ValueError('Not enough consecutive greenhouse records for training')
    return torch.tensor(features, dtype=torch.float32), torch.tensor(target, dtype=torch.float32).unsqueeze(1), torch.tensor(current, dtype=torch.float32).unsqueeze(1)


def main():
    x, y, current = read_samples()
    n1, n2 = int(len(x) * .70), int(len(x) * .85)
    gap = 16  # Prevent samples from straddling chronological split boundaries.
    mean = x[:n1-gap].mean(0)
    std = x[:n1-gap].std(0).clamp_min(.001)
    x = (x - mean) / std
    model = nn.Sequential(nn.Linear(16, 32), nn.ReLU(), nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1))
    loader = DataLoader(TensorDataset(x[:n1-gap], y[:n1-gap]), batch_size=512, shuffle=True, generator=torch.Generator().manual_seed(42))
    optimizer = torch.optim.Adam(model.parameters(), lr=.001)
    loss_fn = nn.SmoothL1Loss()
    best, best_state, stale = float('inf'), None, 0
    for epoch in range(1, 51):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            validation = (model(x[n1:n2-gap]) - y[n1:n2-gap]).abs().mean().item()
        print(f'epoch={epoch:02d} validation_mae={validation:.5f}', flush=True)
        if validation < best - .00005:
            best, stale = validation, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            stale += 1
            if stale >= 8:
                break
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        prediction = model(x[n2:])
        test_mae = (prediction - y[n2:]).abs().mean().item()
        baseline_mae = y[n2:].abs().mean().item()
    export = {
        'model_type': 'pytorch_temperature_delta_mlp',
        'data_source': DATA_URL,
        'training_method': 'chronological 70/15/15 split with boundary gaps; four consecutive five-minute records, target sixty minutes later',
        'features': ['temperature', 'humidity', 'co2', 'light'],
        'mean': mean.tolist(), 'std': std.tolist(),
        'layers': [{'weights': layer.weight.detach().tolist(), 'bias': layer.bias.detach().tolist(),
                    'activation': 'relu' if i < 2 else 'linear'}
                   for i, layer in enumerate(layer for layer in model if isinstance(layer, nn.Linear))],
        'validation_mae_c': round(best, 5), 'test_mae_c': round(test_mae, 5),
        'baseline_persistence_mae_c': round(baseline_mae, 5), 'test_samples': len(x) - n2,
        'seed': 42, 'training_rows': len(x)
    }
    path = ROOT / 'public/model.json'
    path.write_text(json.dumps(export, separators=(',', ':')))
    (ROOT / 'models/metrics.json').write_text(json.dumps({k: export[k] for k in ('validation_mae_c', 'test_mae_c', 'baseline_persistence_mae_c', 'test_samples', 'training_rows', 'seed', 'data_source')}, indent=2))
    print(f'Test MAE {test_mae:.4f} °C; persistence baseline {baseline_mae:.4f} °C on {len(x)-n2} samples')


if __name__ == '__main__':
    main()
