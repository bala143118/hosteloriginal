import argparse
import base64
import io
import json
import sys
from PIL import Image
import torch
import numpy as np


def parse_args():
    parser = argparse.ArgumentParser(description='Run CCTV inference on a single image frame.')
    parser.add_argument('--model', required=True, help='Path to the PyTorch model file (.pt)')
    return parser.parse_args()


def load_image_from_base64(image_base64):
    header, encoded = image_base64.split(',', 1)
    image_bytes = base64.b64decode(encoded)
    with Image.open(io.BytesIO(image_bytes)) as img:
        return img.convert('RGB')


def preprocess_image(image, target_size=(640, 640)):
    image = image.resize(target_size)
    tensor = torch.from_numpy(np.array(image)).float()
    tensor = tensor.permute(2, 0, 1) / 255.0
    tensor = tensor.unsqueeze(0)
    return tensor


def get_names(model, output=None):
    names = None
    for candidate in [model, getattr(model, 'module', None), getattr(output, 'names', None)]:
        if candidate is None:
            continue
        if isinstance(candidate, dict):
            names = candidate
            break
        if hasattr(candidate, 'names'):
            names = candidate.names
            break
    if isinstance(names, dict):
        return [names[i] for i in sorted(names.keys())]
    return list(names) if names is not None else None


def normalize_output(output):
    if hasattr(output, 'results'):
        return output.results
    if isinstance(output, dict) and 'results' in output:
        return output['results']
    if hasattr(output, 'pred'):
        return output.pred
    if hasattr(output, 'preds'):
        return output.preds
    if hasattr(output, 'boxes') and hasattr(output, 'scores'):
        return output
    if isinstance(output, (list, tuple)) and len(output) == 1:
        return output[0]
    return output


def tensor_to_numpy(x):
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    if isinstance(x, np.ndarray):
        return x
    return None


def to_numpy_array(value):
    if value is None:
        return None
    if isinstance(value, torch.Tensor):
        return value.detach().cpu().numpy()
    if isinstance(value, np.ndarray):
        return value
    if hasattr(value, 'numpy'):
        try:
            return value.numpy()
        except Exception:
            pass
    if isinstance(value, (list, tuple)):
        try:
            return np.array(value)
        except Exception:
            pass
    return None


def normalize_box(box):
    if box is None:
        return None
    if isinstance(box, dict):
        x1 = float(box.get('x1', box.get('xmin', box.get('left', box.get('x', 0)))))
        y1 = float(box.get('y1', box.get('ymin', box.get('top', box.get('y', 0)))))
        x2 = float(box.get('x2', box.get('xmax', box.get('right', x1))))
        y2 = float(box.get('y2', box.get('ymax', box.get('bottom', y1))))
        width = float(box.get('width', x2 - x1))
        height = float(box.get('height', y2 - y1))
        return [x1, y1, width, height]

    array = to_numpy_array(box)
    if array is None:
        return None
    if array.ndim == 1 and array.size >= 4:
        x1, y1, x2, y2 = array[:4]
        return [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
    return None


def get_object_arrays(obj):
    if obj is None:
        return None, None, None

    boxes = None
    scores = None
    labels = None

    if hasattr(obj, 'boxes'):
        boxes = getattr(obj, 'boxes')
    elif hasattr(obj, 'xyxy'):
        boxes = getattr(obj, 'xyxy')

    if hasattr(obj, 'scores'):
        scores = getattr(obj, 'scores')
    elif hasattr(obj, 'conf'):
        scores = getattr(obj, 'conf')
    elif hasattr(obj, 'probs'):
        scores = getattr(obj, 'probs')

    if hasattr(obj, 'labels'):
        labels = getattr(obj, 'labels')
    elif hasattr(obj, 'cls'):
        labels = getattr(obj, 'cls')

    if boxes is not None and not isinstance(boxes, (list, tuple, np.ndarray, torch.Tensor)):
        if hasattr(boxes, 'conf') and scores is None:
            scores = getattr(boxes, 'conf')
        if hasattr(boxes, 'cls') and labels is None:
            labels = getattr(boxes, 'cls')
        if hasattr(boxes, 'xyxy') and boxes is not None:
            boxes = getattr(boxes, 'xyxy')
        elif hasattr(boxes, 'xywh'):
            boxes = getattr(boxes, 'xywh')

    if hasattr(boxes, 'data'):
        boxes = getattr(boxes, 'data')
    return boxes, scores, labels


def parse_object_predictions(output, names=None):
    boxes, scores, labels = get_object_arrays(output)
    boxes = to_numpy_array(boxes)
    scores = to_numpy_array(scores)
    labels = to_numpy_array(labels)

    if boxes is None or boxes.ndim != 2 or boxes.shape[1] < 4:
        return None

    if scores is None:
        scores = np.ones((boxes.shape[0],), dtype=np.float32)
    if labels is None:
        labels = np.zeros((boxes.shape[0],), dtype=np.int64)

    boxes = boxes.astype(float)
    scores = scores.astype(float)
    labels = labels.astype(int)

    detections = []
    for i in range(boxes.shape[0]):
        label_idx = int(labels[i])
        label = str(label_idx)
        if names and 0 <= label_idx < len(names):
            label = names[label_idx]
        normalized_box = normalize_box(boxes[i])
        if normalized_box is None:
            continue
        detections.append({
            'label': label,
            'confidence': float(scores[i]),
            'box': normalized_box
        })

    return {'predictions': detections}


def parse_tensor_predictions(output, names=None):
    if isinstance(output, torch.Tensor):
        output = output.detach().cpu()
    if isinstance(output, np.ndarray):
        output = output
    if hasattr(output, 'numpy'):
        output = output.numpy()

    if isinstance(output, np.ndarray) and output.ndim == 3 and output.shape[0] == 1 and output.shape[2] >= 6:
        preds = output[0]
        detections = []
        for det in preds:
            if len(det) < 6:
                continue
            x1, y1, x2, y2, conf, cls = det[:6]
            label = str(int(cls))
            if names and int(cls) < len(names):
                label = names[int(cls)]
            detections.append({
                'label': label,
                'confidence': float(conf),
                'box': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
            })
        return {'predictions': detections}

    if isinstance(output, np.ndarray) and output.ndim == 2 and output.shape[0] == 1:
        probs = output[0]
        top_idx = int(np.argmax(probs))
        label = str(top_idx)
        if names and top_idx < len(names):
            label = names[top_idx]
        return {'predictions': [{'label': label, 'confidence': float(probs[top_idx])}]}

    return None


def parse_dict_predictions(output, names=None):
    if not isinstance(output, dict):
        return None

    predictions = []
    if 'predictions' in output and isinstance(output['predictions'], (list, tuple)):
        return {'predictions': list(output['predictions'])}

    if 'boxes' in output and 'scores' in output and 'labels' in output:
        boxes = output['boxes']
        scores = output['scores']
        labels = output['labels']
        if isinstance(boxes, torch.Tensor):
            boxes = boxes.detach().cpu().numpy()
        if isinstance(scores, torch.Tensor):
            scores = scores.detach().cpu().numpy()
        if isinstance(labels, torch.Tensor):
            labels = labels.detach().cpu().numpy()
        for i in range(len(boxes)):
            cls_idx = int(labels[i])
            label = str(cls_idx)
            if names and cls_idx < len(names):
                label = names[cls_idx]
            x1, y1, x2, y2 = boxes[i][:4]
            predictions.append({
                'label': label,
                'confidence': float(scores[i]),
                'box': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
            })
        return {'predictions': predictions}

    if 'boxes' in output and 'labels' in output:
        boxes = output['boxes']
        labels = output['labels']
        scores = output.get('scores', [1.0] * len(labels))
        if isinstance(boxes, torch.Tensor):
            boxes = boxes.detach().cpu().numpy()
        if isinstance(labels, torch.Tensor):
            labels = labels.detach().cpu().numpy()
        if isinstance(scores, torch.Tensor):
            scores = scores.detach().cpu().numpy()
        for i in range(len(boxes)):
            cls_idx = int(labels[i])
            label = str(cls_idx)
            if names and cls_idx < len(names):
                label = names[cls_idx]
            x1, y1, x2, y2 = boxes[i][:4]
            predictions.append({
                'label': label,
                'confidence': float(scores[i]),
                'box': [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
            })
        return {'predictions': predictions}

    return None


def extract_predictions(output, model):
    output = normalize_output(output)
    names = get_names(model, output)

    if isinstance(output, dict):
        parsed = parse_dict_predictions(output, names)
        if parsed is not None:
            return parsed

    object_parsed = parse_object_predictions(output, names)
    if object_parsed is not None:
        return object_parsed

    tensor_parsed = parse_tensor_predictions(output, names)
    if tensor_parsed is not None:
        return tensor_parsed

    if isinstance(output, (list, tuple)) and len(output) > 0:
        first = output[0]
        tensor_parsed = parse_tensor_predictions(first, names)
        if tensor_parsed is not None:
            return tensor_parsed
        if isinstance(first, dict):
            parsed = parse_dict_predictions(first, names)
            if parsed is not None:
                return parsed
            object_parsed = parse_object_predictions(first, names)
            if object_parsed is not None:
                return object_parsed
        else:
            object_parsed = parse_object_predictions(first, names)
            if object_parsed is not None:
                return object_parsed

    if isinstance(output, dict):
        return {'predictions': [output]}
    if isinstance(output, list):
        return {'predictions': output}
    return {'predictions': [str(output)]}


def load_model(path):
    try:
        from ultralytics import YOLO
        model = YOLO(path)
        return model, 'ultralytics'
    except Exception:
        pass

    model = torch.load(path, map_location='cpu')
    if isinstance(model, dict) and 'model' in model:
        model = model['model']
    if hasattr(model, 'eval'):
        model.eval()
    return model, 'torch'


def run_model(model, input_tensor, image, loader_type):
    if loader_type == 'ultralytics':
        try:
            results = model.predict(
                source=image,
                imgsz=960,
                conf=0.2,
                iou=0.45,
                max_det=10,
                device='cpu',
                verbose=False
            )
            if isinstance(results, (list, tuple)) and len(results) > 0:
                return results[0]
            return results
        except Exception:
            pass

    return model(input_tensor)


def main():
    args = parse_args()
    model, loader_type = load_model(args.model)

    input_data = sys.stdin.read()
    request = json.loads(input_data)
    image_data = request.get('image')

    if not image_data:
        print(json.dumps({'success': False, 'error': 'No image provided.'}))
        return

    try:
        image = load_image_from_base64(image_data)
        tensor = preprocess_image(image)
        with torch.no_grad():
            output = run_model(model, tensor, image, loader_type)

        parsed = extract_predictions(output, model)
        print(json.dumps({'success': True, 'result': parsed}))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))


if __name__ == '__main__':
    main()
