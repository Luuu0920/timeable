import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

raw = open('D:/AI工厂/timetable/tools/tbl.json', encoding='utf-8').read()
# edsdk may print extra lines; find the JSON object
start = raw.find('{')
data = json.loads(raw[start:])

blk = data.get('block', data)
tbl = blk.get('table', blk)
cells = tbl['cells']
rc = tbl.get('row_count') or blk.get('row_count')
cc = tbl.get('col_count') or blk.get('col_count')
print('rows=%s cols=%s' % (rc, cc))
print('=' * 100)

grid = {}
for c in cells:
    r, co = c['row'], c['col']
    txt = (c.get('text') or '').replace('\n', '\\n')
    mg = c.get('is_merge_continue')
    grid[(r, co)] = (txt, mg)

for r in range(1, (rc or 0) + 1):
    row_out = []
    for co in range(1, (cc or 0) + 1):
        t, mg = grid.get((r, co), ('', None))
        if mg:
            t = '·'
        row_out.append('[%d,%d]%s' % (r, co, t))
    print(' | '.join(row_out))
    print('-' * 100)
