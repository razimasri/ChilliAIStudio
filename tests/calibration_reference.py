"""Run the repository's unchanged Python calibration and fill code as an oracle.
Requires Python with numpy and opencv-python-headless.
"""
import ast
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import cv2
import numpy

source = ast.parse(Path('python_src/ChilliMark.py').read_text())
nodes = []
for node in source.body:
    if isinstance(node, ast.FunctionDef) and node.name in {'get_thresh', 'area', 'contour_center', 'find_responses'}:
        nodes.append(node)
    elif isinstance(node, ast.ClassDef) and node.name == 'Question':
        nodes.append(node)
    elif isinstance(node, ast.ClassDef) and node.name == 'Parameters':
        node.body = [method for method in node.body if isinstance(method, ast.FunctionDef) and method.name == 'set_box']
        nodes.append(node)
ns = {'cv2': cv2, 'numpy': numpy, 'Student': object}
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'original ChilliMark.py', 'exec'), ns)
spec = json.loads(Path(sys.argv[1]).read_text())
image = cv2.imread(spec['image'])
params = ns['Parameters']()
params.box_x1, params.box_y1, params.box_x2, params.box_y2 = spec['selection']
params.set_box(image)
questions = []
for i, centers in enumerate(spec['centers']):
    q = ns['Question'](i)
    q.boxes = [ns['Question'].Box(numpy.array(center), c) for c, center in enumerate(centers)]
    questions.append(q)
student = SimpleNamespace(questions=questions, incomplete=[])
ns['find_responses'](student, image, params)
print(json.dumps({
    'w': params.w, 'h': params.h,
    'outer': params.outer.reshape(-1, 2).tolist(),
    'inner': params.inner.reshape(-1, 2).tolist(),
    'fill_limit': params.fill_limit,
    'responses': [q.response for q in questions],
    'filled': [[b.bool for b in q.boxes] for q in questions],
}))
