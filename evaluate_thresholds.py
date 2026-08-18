"""Record every fire/smoke detection on reviewed negative and real-smoke test frames."""
from __future__ import annotations
import argparse,json
from pathlib import Path
from ultralytics import YOLO
ROOT=Path(__file__).resolve().parent; EXTS={'.jpg','.jpeg','.png','.bmp','.webp'}; TH=(.30,.40,.50,.60,.70,.80,.90)
def pics(d):return[p for p in Path(d).rglob('*')if p.suffix.lower()in EXTS]
def scan(model,items,c):
 out=[]
 for path in items:
  r=model.predict(str(path),conf=c,imgsz=640,verbose=False)[0]
  for b in r.boxes: out.append({'image':str(path.relative_to(ROOT)),'predicted_class':r.names[int(b.cls)],'confidence':float(b.conf),'bounding_box_xyxy':[float(x)for x in b.xyxy[0]]})
 return out
def main():
 p=argparse.ArgumentParser();p.add_argument('--model',required=True);a=p.parse_args();m=YOLO(a.model);neg=pics(ROOT/'dataset/hard_negatives');real=pics(ROOT/'dataset/real_smoke_test');report={'model':a.model,'negative_images':len(neg),'real_smoke_images':len(real),'thresholds':{}}
 for c in TH:
  fp=scan(m,neg,c);report['thresholds'][str(c)]={'false_positive_count':len(fp),'false_positive_rate_per_image':len(fp)/len(neg) if neg else None,'false_positive_detections':fp,'real_smoke_detections':scan(m,real,c)}
 out=ROOT/'training_reports';out.mkdir(exist_ok=True);(out/'threshold_report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
