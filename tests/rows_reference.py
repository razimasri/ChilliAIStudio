"""Execute the unchanged Python grid routines on supplied box centers."""
import ast
import contextlib
import io
import json
import operator
import sys
from pathlib import Path
from types import SimpleNamespace

source = ast.parse(Path('python_src/ChilliMark.py').read_text())
nodes = [n for n in source.body if
         isinstance(n, ast.FunctionDef) and n.name in {'sort_into_columns', 'sort_into_rows', 'missing', 'find_questions'}
         or isinstance(n, ast.ClassDef) and n.name == 'Question']
ns = {'operator': operator, 'Parameters': SimpleNamespace}
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'original ChilliMark.py', 'exec'), ns)
results = []
for spec in json.load(sys.stdin):
    params = SimpleNamespace(**spec['params'])
    if hasattr(params, 'key'):
        params.key = {int(k): v for k, v in params.key.items()}
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            columns, boxes = ns['sort_into_columns'](spec['boxes'], params)
            ns['sort_into_rows'](boxes, params)
            before = json.loads(json.dumps(columns))
            ns['missing'](columns, params, None)
            questions = ns['find_questions'](columns, params)
        results.append({'name': spec['name'], 'col_avg': params.col_avg, 'row_avg': params.row_avg,
                        'x_jump': params.x_jump, 'y_jump': params.y_jump, 'choices': params.choices,
                        'before': before, 'columns': columns,
                        'questions': [{'number': q.number, 'boxes': [{'xy': b.xy, 'letter': b.letter} for b in q.boxes]} for q in questions]})
    except Exception as error:
        results.append({'name': spec['name'], 'error': type(error).__name__ + ': ' + str(error), **{k: getattr(params,k) for k in ['col_avg','row_avg','x_jump','y_jump','choices'] if hasattr(params,k)}})
print(json.dumps(results))
