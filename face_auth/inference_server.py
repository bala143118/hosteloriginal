import argparse
import base64
import contextlib
import io
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from face_auth import FaceAuthSystem

CCTV_FACE_THRESHOLD = 0.35
CCTV_MATCH_THRESHOLD = 0.40
CCTV_MIN_FACE_SIZE = 28
CCTV_TARGET_MIN_WIDTH = 1400
CCTV_TARGET_MIN_HEIGHT = 900


def parse_args():
    parser = argparse.ArgumentParser(
        description='Keep the face authentication models loaded for webcam and video frames.'
    )
    parser.add_argument(
        '--embeddings-dir',
        default=str(Path(__file__).resolve().parent / 'face_auth' / 'embeddings'),
        help='Directory containing authorized face embedding files.'
    )
    return parser.parse_args()


def load_image_from_base64(image_data):
    if not image_data:
        raise ValueError('No image provided.')

    payload = image_data.split(',', 1)[1] if ',' in image_data else image_data
    try:
        binary = base64.b64decode(payload, validate=True)
    except Exception as error:
        raise ValueError('Invalid base64 image payload.') from error

    array = np.frombuffer(binary, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Unable to decode image payload.')
    return image


def prepare_cctv_frame(image):
    height, width = image.shape[:2]
    if width <= 0 or height <= 0:
        return image, 1.0

    max_dim = max(width, height)
    if max_dim > 960:
        scale = 960.0 / float(max_dim)
        resized = cv2.resize(
            image,
            (int(round(width * scale)), int(round(height * scale))),
            interpolation=cv2.INTER_LINEAR
        )
        return resized, scale

    return image, 1.0


def serialize_face(result):
    x1, y1, x2, y2 = [int(value) for value in result.bbox]
    return {
        'authorized': bool(result.matched),
        'label': result.authorization_label,
        'confidence': float(result.confidence),
        'box': [x1, y1, max(0, x2 - x1), max(0, y2 - y1)],
        'matchedName': result.name if result.matched else None
    }


def scale_face_to_original(face, scale):
    if scale <= 1.0:
        return face

    x, y, w, h = [float(value) for value in face['box']]
    face['box'] = [
        int(round(x / scale)),
        int(round(y / scale)),
        max(1, int(round(w / scale))),
        max(1, int(round(h / scale)))
    ]
    return face


def summarize(faces, known_faces_count):
    if not faces:
        return 'No Face Detected', 'No face detected in the current frame.'

    authorized_count = sum(1 for face in faces if face['authorized'])
    unauthorized_count = len(faces) - authorized_count

    if authorized_count and unauthorized_count:
        return 'Mixed', 'Authorized and unauthorized faces detected.'
    if authorized_count:
        return 'Authorized', 'Authorized face detected.'
    if known_faces_count <= 0:
        return 'Unauthorized', 'No authorized faces are trained yet.'
    return 'Unauthorized', 'Unauthorized face detected.'


def main():
    args = parse_args()
    embeddings_dir = Path(args.embeddings_dir).resolve()
    embeddings_dir.mkdir(parents=True, exist_ok=True)

    with contextlib.redirect_stdout(io.StringIO()):
        system = FaceAuthSystem(
            embeddings_dir=embeddings_dir,
            face_threshold=CCTV_FACE_THRESHOLD,
            match_threshold=CCTV_MATCH_THRESHOLD,
            min_face_size=CCTV_MIN_FACE_SIZE
        )

    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get('reloadKnownFaces'):
                system.reload_known_faces()

            frame = load_image_from_base64(request.get('image'))
            prepared_frame, scale = prepare_cctv_frame(frame)
            auth_results = system.authenticate(prepared_frame)
            faces = [scale_face_to_original(serialize_face(result), scale) for result in auth_results]
            status, summary = summarize(faces, len(system.known_embeddings))
            top_confidence = max((face['confidence'] for face in faces), default=0.0)

            result = {
                'success': True,
                'result': {
                    'status': status,
                    'summary': summary,
                    'faces': faces,
                    'authorizedCount': sum(1 for face in faces if face['authorized']),
                    'unauthorizedCount': sum(1 for face in faces if not face['authorized']),
                    'knownFacesCount': len(system.known_embeddings),
                    'topConfidence': float(top_confidence)
                }
            }
        except Exception as error:
            result = {'success': False, 'error': str(error)}

        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
