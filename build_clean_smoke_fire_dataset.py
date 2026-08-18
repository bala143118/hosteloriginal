"""Build a clean 2-class detection dataset from the validated original source.

The source is never changed.  Source fire (0) stays fire (0), source smoke (3)
becomes smoke (1), and light/no-fire rows are removed.  Empty labels are retained
as negative/background training examples.
"""
from __future__ import annotations
import shutil
from collections import Counter
from pathlib import Path
from PIL import Image, UnidentifiedImageError

ROOT=Path(__file__).resolve().parent
SOURCE=Path(r"C:\Users\Balamurugan S\Downloads\fire-detection.v1i.yolov8")
TARGET=ROOT/'dataset_clean'; EXTS={'.jpg','.jpeg','.png','.bmp','.webp'}; MAP={0:0,3:1}

def main():
 if not SOURCE.is_dir(): raise SystemExit(f'Missing source dataset: {SOURCE}')
 if TARGET.exists() and any(TARGET.iterdir()): raise SystemExit(f'{TARGET} already contains data; refusing to overwrite it.')
 counts=Counter(); images=Counter(); labels=Counter(); empty=Counter(); malformed=[]
 for old,new in (('train','train'),('valid','val'),('test','test')):
  source_images=SOURCE/old/'images'; source_labels=SOURCE/old/'labels'
  for d in (TARGET/'images'/new,TARGET/'labels'/new):d.mkdir(parents=True,exist_ok=True)
  for image in source_images.iterdir():
   if image.suffix.lower() not in EXTS:continue
   label=source_labels/(image.stem+'.txt')
   if not label.exists(): malformed.append(f'{old}/{image.name}: missing label');continue
   try:
    with Image.open(image) as im: im.verify()
   except (UnidentifiedImageError,OSError) as e:malformed.append(f'{old}/{image.name}: corrupt ({e})');continue
   kept=[]
   for no,row in enumerate(label.read_text(encoding='utf-8').splitlines(),1):
    f=row.split()
    if len(f)!=5:malformed.append(f'{old}/{label.name}:{no}: {row} (expected 5 fields)');continue
    try: c=int(f[0]); x,y,w,h=map(float,f[1:])
    except ValueError:malformed.append(f'{old}/{label.name}:{no}: {row} (non-numeric)');continue
    if c not in (0,1,2,3) or not all(0<v<=1 for v in (x,y,w,h)) or x-w/2<0 or x+w/2>1 or y-h/2<0 or y+h/2>1:
     malformed.append(f'{old}/{label.name}:{no}: {row} (invalid class/bbox)');continue
    if c in MAP:
     kept.append(f'{MAP[c]} {x:.6f} {y:.6f} {w:.6f} {h:.6f}');counts[(new,MAP[c])]+=1
   shutil.copy2(image,TARGET/'images'/new/image.name); (TARGET/'labels'/new/(image.stem+'.txt')).write_text(('\n'.join(kept)+'\n') if kept else '',encoding='utf-8')
   images[new]+=1;labels[new]+=1;empty[new]+=not bool(kept)
 report=['Clean smoke/fire dataset build report','Source: '+str(SOURCE),'Classes: 0=fire, 1=smoke','']
 for split in ('train','val','test'):
  report.append(f'{split}: images={images[split]}, labels={labels[split]}, fire={counts[(split,0)]}, smoke={counts[(split,1)]}, empty-background={empty[split]}')
 report += ['',f'Malformed source rows skipped: {len(malformed)}']+malformed
 report += ['', 'Suitability: READY FOR TRAINING' if not malformed and counts[('train',1)] and counts[('val',1)] else 'Suitability: DATASET STILL INVALID']
 (ROOT/'dataset_clean_report.txt').write_text('\n'.join(report)+'\n',encoding='utf-8');print('\n'.join(report))
if __name__=='__main__':main()
