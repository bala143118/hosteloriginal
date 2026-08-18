"""Validate and safely convert source labels: fire=0, light=1, no-fire=2, smoke=3."""
from __future__ import annotations
import argparse, hashlib, shutil
from collections import Counter
from pathlib import Path
from PIL import Image, UnidentifiedImageError

ROOT=Path(__file__).resolve().parent; DATASET=ROOT/'dataset'; EXTS={'.jpg','.jpeg','.png','.bmp','.webp'}
MAP={0:0,3:1}
def files(folder, exts): return [x for x in folder.rglob('*') if x.suffix.lower() in exts]
def image_map(split): return {p.stem:p for p in files(DATASET/'images'/split, EXTS)}
def label_map(split): return {p.stem:p for p in files(DATASET/'labels'/split,{'.txt'})}
def audit(convert=False):
 report=['Smoke/fire data preflight', 'Source mapping: 0=fire, 1=light, 2=no-fire, 3=smoke', 'Target mapping: 0=fire, 1=smoke', '']
 errors=[]; counts=Counter(); discarded=Counter(); hashes={}; summary={}
 for split in ('train','val'):
  images,labels=image_map(split),label_map(split); missing_labels=set(images)-set(labels); orphan_labels=set(labels)-set(images)
  summary[split]=(len(images),len(labels),len(missing_labels),len(orphan_labels)); report.append(f'{split}: images={len(images)}, labels={len(labels)}, missing-label-images={len(missing_labels)}, orphan-labels={len(orphan_labels)}')
  for stem,path in images.items():
   try:
    with Image.open(path) as im:
     if im.width<2 or im.height<2: errors.append(f'{path}: invalid dimensions')
     im.verify()
    hashes.setdefault(hashlib.sha256(path.read_bytes()).hexdigest(),[]).append(str(path.relative_to(ROOT)))
   except (UnidentifiedImageError,OSError) as e: errors.append(f'{path}: corrupt image ({e})')
  if missing_labels: errors.append(f'{split}: image labels missing ({len(missing_labels)})')
  if orphan_labels: errors.append(f'{split}: labels have no matching images ({len(orphan_labels)})')
  for stem,path in labels.items():
   kept=[]
   for lineno,row in enumerate(path.read_text(encoding='utf-8',errors='replace').splitlines(),1):
    f=row.split()
    if len(f)!=5: errors.append(f'{path}:{lineno}: expected 5 fields'); continue
    try: cid=int(f[0]); box=list(map(float,f[1:]))
    except ValueError: errors.append(f'{path}:{lineno}: nonnumeric label'); continue
    if cid not in (0,1,2,3): errors.append(f'{path}:{lineno}: source class {cid} invalid'); continue
    x,y,w,h=box
    if not all(0<v<=1 for v in box) or x-w/2<0 or x+w/2>1 or y-h/2<0 or y+h/2>1: errors.append(f'{path}:{lineno}: invalid normalized bbox'); continue
    if cid in MAP: counts[MAP[cid]]+=1; kept.append(f'{MAP[cid]} {x:.6f} {y:.6f} {w:.6f} {h:.6f}')
    else: discarded[cid]+=1
   # Conversion is deliberately blocked until splits have matching images/labels.
   if convert and not missing_labels and not orphan_labels:
    backup=DATASET/'labels_backup_original'/split/path.name
    backup.parent.mkdir(parents=True,exist_ok=True)
    if not backup.exists(): shutil.copy2(path,backup)
    path.write_text(('\n'.join(kept)+'\n') if kept else '',encoding='utf-8')
 report += ['', f'Target object distribution: fire={counts[0]}, smoke={counts[1]}', f'Removed source objects: light={discarded[1]}, no-fire={discarded[2]}', f'Invalid/corrupt findings: {len(errors)}', f'Duplicate image groups: {sum(len(x)>1 for x in hashes.values())}']
 report += errors
 return '\n'.join(report)+'\n', errors, summary
def main():
 p=argparse.ArgumentParser(); p.add_argument('--convert',action='store_true'); a=p.parse_args(); text,errors,summary=audit(a.convert)
 out=ROOT/'training_reports';out.mkdir(exist_ok=True); (out/'dataset_report.txt').write_text(text,encoding='utf-8');print(text)
 # Mismatched splits are a hard blocker even if labels themselves parse.
 if any(v[2] or v[3] for v in summary.values()) or errors: raise SystemExit('Dataset preflight failed. No label conversion performed.')
if __name__=='__main__': main()
