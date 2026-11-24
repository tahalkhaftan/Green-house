"""Train and evaluate multi-target PyTorch forecasts on historical greenhouse records."""
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
HISTORY, HORIZON, SEED = 12, 12, 42
random.seed(SEED)
torch.manual_seed(SEED)
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
    features, target = [], []
    for i in range(HISTORY - 1, len(values) - HORIZON):
        if any(not 240 <= times[j + 1] - times[j] <= 360 for j in range(i - HISTORY + 1, i + HORIZON)):
            continue
        features.append([x for sample in values[i-HISTORY+1:i+1] for x in sample])
        target.append([values[i+HORIZON][0]-values[i][0], values[i+HORIZON][1]-values[i][1]])
    if len(features) < 1000:
        raise ValueError('Not enough consecutive greenhouse records for training')
    return torch.tensor(features,dtype=torch.float32),torch.tensor(target,dtype=torch.float32)


def train_candidate(x,y,normalized,train_stop,val_start,val_stop,y_mean,y_std,widths,seed):
    torch.manual_seed(seed)
    dims=[HISTORY*4,*widths,2];layers=[]
    for i in range(len(dims)-1):
        layers.append(nn.Linear(dims[i],dims[i+1]))
        if i<len(dims)-2:layers.append(nn.ReLU())
    model=nn.Sequential(*layers)
    loader=DataLoader(TensorDataset(x[:train_stop],normalized[:train_stop]),batch_size=512,shuffle=True,generator=torch.Generator().manual_seed(seed))
    optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001)
    loss_fn=nn.SmoothL1Loss();best=float('inf');best_state=None;stale=0
    baseline=y[val_start:val_stop].abs().mean(0).clamp_min(.001)
    for epoch in range(1,46):
        model.train()
        for xb,yb in loader:
            optimizer.zero_grad();loss=loss_fn(model(xb),yb);loss.backward();optimizer.step()
        model.eval()
        with torch.no_grad():
            prediction=model(x[val_start:val_stop])*y_std+y_mean
            errors=(prediction-y[val_start:val_stop]).abs().mean(0)
            score=(errors/baseline).mean().item()
        print(f'widths={widths} epoch={epoch:02d} val_temp={errors[0]:.4f} val_humidity={errors[1]:.4f} score={score:.5f}',flush=True)
        if score<best-.00005:
            best,stale=score,0;best_state={k:v.detach().clone() for k,v in model.state_dict().items()}
        else:
            stale+=1
            if stale>=7:break
    model.load_state_dict(best_state);model.eval()
    with torch.no_grad():
        val_prediction=model(x[val_start:val_stop])*y_std+y_mean
        val_mae=(val_prediction-y[val_start:val_stop]).abs().mean(0).tolist()
    return model,best,val_mae


def train_temperature_reference():
    """Independent short-history temperature network, selected by validation MAE."""
    values,times=[],[]
    with get_data().open(newline='',encoding='utf-8') as file:
        for row in csv.DictReader(file):
            try:
                datum=[float(row[k]) for k in ('temperature','humidity','co2','light')]
                timestamp=datetime.fromisoformat(row['timestamp'].strip()[:26]).replace(tzinfo=timezone.utc).timestamp()
                if not all(math.isfinite(x) for x in datum):continue
                if not (-10<=datum[0]<=60 and 0<=datum[1]<=100 and 0<=datum[2]<=10000 and 0<=datum[3]<=4000):continue
                values.append(datum);times.append(timestamp)
            except (ValueError,KeyError,TypeError):continue
    features,target=[],[]
    for i in range(3,len(values)-12):
        if any(not 240<=times[j+1]-times[j]<=360 for j in range(i-3,i+12)):continue
        features.append([x for sample in values[i-3:i+1] for x in sample]);target.append(values[i+12][0]-values[i][0])
    x=torch.tensor(features,dtype=torch.float32);y=torch.tensor(target,dtype=torch.float32).unsqueeze(1)
    n1,n2=int(len(x)*.70),int(len(x)*.85);gap=16
    mean=x[:n1-gap].mean(0);std=x[:n1-gap].std(0).clamp_min(.001);x=(x-mean)/std
    torch.manual_seed(SEED)
    model=nn.Sequential(nn.Linear(16,32),nn.ReLU(),nn.Linear(32,16),nn.ReLU(),nn.Linear(16,1))
    loader=DataLoader(TensorDataset(x[:n1-gap],y[:n1-gap]),batch_size=512,shuffle=True,generator=torch.Generator().manual_seed(SEED))
    optimizer=torch.optim.Adam(model.parameters(),lr=.001);loss_fn=nn.SmoothL1Loss();best=float('inf');state=None;stale=0
    for epoch in range(1,51):
        model.train()
        for xb,yb in loader:
            optimizer.zero_grad();loss=loss_fn(model(xb),yb);loss.backward();optimizer.step()
        model.eval()
        with torch.no_grad():validation=(model(x[n1:n2-gap])-y[n1:n2-gap]).abs().mean().item()
        print(f'temperature epoch={epoch:02d} validation_mae={validation:.5f}',flush=True)
        if validation<best-.00005:best,stale=validation,0;state={k:v.detach().clone() for k,v in model.state_dict().items()}
        else:
            stale+=1
            if stale>=8:break
    model.load_state_dict(state);model.eval()
    with torch.no_grad():
        test=(model(x[n2:])-y[n2:]).abs().mean().item();baseline=y[n2:].abs().mean().item()
    linear=[layer for layer in model if isinstance(layer,nn.Linear)]
    network={'history_length':4,'mean':mean.tolist(),'std':std.tolist(),
       'layers':[{'weights':layer.weight.detach().tolist(),'bias':layer.bias.detach().tolist(),'activation':'relu' if i<len(linear)-1 else 'linear'} for i,layer in enumerate(linear)]}
    return model,network,best,test,baseline,len(x)-n2,len(x)


def main():
    temp_model,temp_network,temp_val,temp_test,temp_baseline,temp_n,temp_rows=train_temperature_reference()
    x,y=read_samples();n1,n2=int(len(x)*.70),int(len(x)*.85);gap=HISTORY+HORIZON
    train_stop,val_stop=n1-gap,n2-gap
    mean=x[:train_stop].mean(0);std=x[:train_stop].std(0).clamp_min(.001);x=(x-mean)/std
    y_mean=y[:train_stop].mean(0);y_std=y[:train_stop].std(0).clamp_min(.001);normalized=(y-y_mean)/y_std
    candidates=[]
    for i,widths in enumerate([(64,32),(128,64,32)]):
        model,score,val_mae=train_candidate(x,y,normalized,train_stop,n1,val_stop,y_mean,y_std,widths,SEED+i)
        candidates.append((score,widths,val_mae,model))
    score,widths,val_mae,model=min(candidates,key=lambda item:item[0])
    with torch.no_grad():
        prediction=model(x[n2:])*y_std+y_mean
        test_mae=(prediction-y[n2:]).abs().mean(0).tolist()
        baseline=y[n2:].abs().mean(0).tolist()
    linear=[layer for layer in model if isinstance(layer,nn.Linear)]
    humidity_network={'history_length':HISTORY,'mean':mean.tolist(),'std':std.tolist(),'target_mean':y_mean.tolist(),'target_std':y_std.tolist(),'output_index':1,
      'layers':[{'weights':layer.weight.detach().tolist(),'bias':layer.bias.detach().tolist(),'activation':'relu' if i<len(linear)-1 else 'linear'} for i,layer in enumerate(linear)]}
    export={'model_type':'pytorch_independent_temperature_and_humidity','data_source':DATA_URL,
      'training_method':'separate networks, chronological 70/15/15 splits with boundary gaps; humidity architecture selected on validation only',
      'features':['temperature','humidity','co2','light'],'history_length':HISTORY,'horizon_minutes':60,
      'temperature_model':temp_network,'humidity_model':humidity_network,
      'validation_mae_c':round(temp_val,5),'validation_mae_humidity_pct':round(val_mae[1],5),
      'test_mae_c':round(temp_test,5),'test_mae_humidity_pct':round(test_mae[1],5),
      'baseline_persistence_mae_c':round(temp_baseline,5),'baseline_persistence_mae_humidity_pct':round(baseline[1],5),
      'test_samples':temp_n,'humidity_test_samples':len(x)-n2,'seed':SEED,'training_rows':temp_rows,'humidity_training_rows':len(x),'selected_hidden_layers':list(widths),
      'validation_candidates':[{'hidden_layers':list(w),'score':round(sc,5),'mae_c':round(v[0],5),'mae_humidity_pct':round(v[1],5)} for sc,w,v,_ in candidates]}
    (ROOT/'public/model.json').write_text(json.dumps(export,separators=(',',':')))
    keys=('validation_mae_c','validation_mae_humidity_pct','test_mae_c','test_mae_humidity_pct','baseline_persistence_mae_c','baseline_persistence_mae_humidity_pct','test_samples','humidity_test_samples','training_rows','humidity_training_rows','seed','data_source','selected_hidden_layers','validation_candidates')
    (ROOT/'models/metrics.json').write_text(json.dumps({k:export[k] for k in keys},indent=2))
    torch.save({'temperature_state_dict':temp_model.state_dict(),'temperature_hidden_layers':[32,16],'temperature_feature_mean':torch.tensor(temp_network['mean']),'temperature_feature_std':torch.tensor(temp_network['std']),'humidity_state_dict':model.state_dict(),'humidity_hidden_layers':widths,'humidity_feature_mean':mean,'humidity_feature_std':std,'humidity_target_mean':y_mean,'humidity_target_std':y_std},ROOT/'models/greenhouse_forecaster.pt')
    print(f'Test: temperature MAE {temp_test:.4f} °C (baseline {temp_baseline:.4f}); humidity MAE {test_mae[1]:.4f} percentage points (baseline {baseline[1]:.4f}); samples={temp_n}/{len(x)-n2}')

if __name__=='__main__':main()
