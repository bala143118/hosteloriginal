import argparse
import contextlib
import io
import json
import sys

import numpy as np
from ultralytics import YOLO

from inference import load_image_from_base64, load_model, preprocess_image, extract_predictions, run_model, torch


def parse_args():
    parser = argparse.ArgumentParser(description='Keep fire, smoke, and crowd models loaded for CCTV frames.')
    parser.add_argument('--model', required=True, help='Path to the PyTorch model file (.pt)')
    parser.add_argument('--crowd-model', required=True, help='Path to the YOLO person detection model (.pt)')
    return parser.parse_args()


def extract_people(result):
    people = []
    boxes = result.boxes
    if boxes is None:
        return people

    coordinates = boxes.xyxy.detach().cpu().numpy()
    confidences = boxes.conf.detach().cpu().numpy()
    track_ids = boxes.id.detach().cpu().numpy().astype(int) if boxes.id is not None else [None] * len(coordinates)
    for coordinate, confidence, track_id in zip(coordinates, confidences, track_ids):
        x1, y1, x2, y2 = coordinate.tolist()
        people.append({
            'label': 'person',
            'confidence': float(confidence),
            'trackId': int(track_id) if track_id is not None else None,
            'box': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
        })
    return people


def main():
    args = parse_args()
    with contextlib.redirect_stdout(io.StringIO()):
        model, loader_type = load_model(args.model)
        crowd_model = YOLO(args.crowd_model)

    for line in sys.stdin:
        try:
            request = json.loads(line)
            image_data = request.get('image')
            include_crowd = bool(request.get('includeCrowd', True))
            if not image_data:
                raise ValueError('No image provided.')

            image = load_image_from_base64(image_data)
            tensor = preprocess_image(image)
            with torch.no_grad():
                with contextlib.redirect_stdout(io.StringIO()):
                    output = run_model(model, tensor, image, loader_type)
                    crowd_results = None
                    if include_crowd:
                        crowd_results = crowd_model.predict(
                            source=np.array(image),
                            classes=[0],
                            conf=0.35,
                            iou=0.5,
                            imgsz=512,
                            device='cpu',
                            verbose=False
                        )
            people = extract_people(crowd_results[0]) if include_crowd and crowd_results else []
            result = {
                'success': True,
                'result': {
                    **extract_predictions(output, model),
                    'crowd': {
                        'personCount': len(people),
                        'threshold': 20,
                        'people': people
                    }
                }
            }
        except Exception as error:
            result = {'success': False, 'error': str(error)}

        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
