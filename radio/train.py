"""Fast PyTorch surrogate for a synthetic channel, NOT measured greenhouse RF.

The targets are exact expectations from a simple Poisson-collision model and an
assumed noise/path-loss term. This is a teaching model, not BLE calibration.
All linear weights are constrained nonnegative, guaranteeing that increasing
any input cannot improve the predicted physical-layer success probability.
"""
from pathlib import Path
import json
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
torch.manual_seed(2981)
torch.set_num_threads(2)

# Features: normalised traffic, interference squared, distance / 3.5 m.
# q = exp(-hazard). Coefficients are illustrative, not fitted measurements.
x = torch.rand(22000, 3)
target_hazard = x[:, 0:1] * 2.7 + x[:, 1:2] * 1.5 + x[:, 2:3] * (0.07 * 3.5)
model = nn.Sequential(nn.Linear(3, 64), nn.ReLU(), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1))
for layer in model:
    if isinstance(layer, nn.Linear):
        nn.init.uniform_(layer.weight, 0.0, 0.08)
        nn.init.zeros_(layer.bias)
loader = DataLoader(TensorDataset(x[:18000], target_hazard[:18000]), batch_size=512,
                    shuffle=True, generator=torch.Generator().manual_seed(2981))
optimizer = torch.optim.Adam(model.parameters(), lr=0.004)
best, best_state = float('inf'), None
for epoch in range(1, 81):
    model.train()
    for xb, yb in loader:
        optimizer.zero_grad()
        loss = (model(xb) - yb).square().mean()
        loss.backward()
        optimizer.step()
        with torch.no_grad():
            for layer in model:
                if isinstance(layer, nn.Linear):
                    layer.weight.clamp_(min=0)
            model[-1].bias.clamp_(min=0)
    model.eval()
    with torch.no_grad():
        score = (torch.exp(-model(x[18000:])) - torch.exp(-target_hazard[18000:])).abs().mean().item()
    if score < best:
        best = score
        best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
    if epoch % 10 == 0:
        print(f'epoch {epoch}: synthetic validation q MAE={score:.6f}', flush=True)
model.load_state_dict(best_state)
layers = [layer for layer in model if isinstance(layer, nn.Linear)]
export = {
    'model_type': 'monotone_pytorch_radio_surrogate',
    'dataset_kind': 'synthetic analytic assumptions; not real RF measurements',
    'features': ['traffic_0_1', 'interference_squared_0_1', 'distance_m_div_3_5'],
    'validation_mae': round(best, 7), 'training_samples': 18000, 'validation_samples': 4000,
    'hidden_layers': [64, 32], 'seed': 2981,
    'layers': [{'weights': layer.weight.detach().tolist(), 'bias': layer.bias.detach().tolist(),
                'activation': 'relu' if i < len(layers)-1 else 'linear'} for i, layer in enumerate(layers)]
}
(ROOT / 'public/radio-model.json').write_text(json.dumps(export, separators=(',', ':')))
(ROOT / 'models/radio_metrics.json').write_text(json.dumps({key: export[key] for key in (
    'model_type', 'dataset_kind', 'validation_mae', 'training_samples', 'validation_samples', 'hidden_layers', 'seed')}, indent=2))
torch.save({'state_dict': model.state_dict(), 'features': export['features'],
            'dataset_kind': export['dataset_kind']}, ROOT / 'models/radio_link.pt')
print(f'Synthetic validation MAE: {best:.6f}; no real-world accuracy is implied.')
