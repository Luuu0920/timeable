import json, io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
raw = open('D:/AI工厂/timetable/tools/tbl.json', encoding='utf-8').read()
data = json.loads(raw[raw.find('{'):])
blk = data.get('block', data)
tbl = blk.get('table', blk)
for c in tbl['cells']:
    t = (c.get('text') or '').strip()
    if t and not c.get('is_merge_continue'):
        print('[%d,%d] %s' % (c['row'], c['col'], t))
