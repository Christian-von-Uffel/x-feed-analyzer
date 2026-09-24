# Downloads the two public datasets used in docs/research/coordination-validation.md and writes
# them as catalogue-shaped posts (the fields coord.js reads), one JSON file per case.
#   python3 extract.py <work dir>      (about 1.2 GB downloaded; nothing is written to the repo)
# IRA retweets and Sentiment140's manual retweets are marked isRepost: in a real capture a repost
# shows as the original author's post and its repost time is unknown, so validate.js drops them.
import csv, datetime, gzip, io, json, os, re, subprocess, sys, zipfile

work = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(os.path.join(work, 'cases'), exist_ok=True)
csv.field_size_limit(10**8)
LEAD = re.compile(r"^['\"]?((?:@\w+[\s,:]*)+)")

def targets(text):
    m = LEAD.match(text)
    reply = re.findall(r'@(\w+)', m.group(1)) if m else []
    return reply, [h for h in re.findall(r'@(\w+)', text) if h not in reply]

# --- IRA handles Twitter gave Congress (FiveThirtyEight / Clemson release) --------------------
IRA = 'https://raw.githubusercontent.com/fivethirtyeight/russian-troll-tweets/master/IRAhandle_tweets_%d.csv'
IRA_CASES = {  # name: (pattern, first day, last day), UTC
    'koch':       (re.compile(r'koch ?farm|#?food ?poisoning', re.I), '2015-11-20', '2015-12-06'),
    'phosphorus': (re.compile(r'phosphorus', re.I), '2015-03-08', '2015-03-13'),
    'ebola_atl':  (re.compile(r'ebola', re.I), '2014-12-11', '2014-12-16'),
}
out = {k: [] for k in IRA_CASES}
for i in range(1, 14):
    p = subprocess.Popen(['curl', '-sL', IRA % i], stdout=subprocess.PIPE)
    for r in csv.DictReader(io.TextIOWrapper(p.stdout, encoding='utf-8', newline='')):
        if r['language'] != 'English' or not r['tweet_id'].isdigit():
            continue
        hits = [k for k, (pat, _, _) in IRA_CASES.items() if pat.search(r['content'])]
        if not hits:
            continue
        # Tweet ids carry their creation time to the millisecond (publish_date only has minutes).
        t = datetime.datetime.utcfromtimestamp(((int(r['tweet_id']) >> 22) + 1288834974657) / 1000)
        text = r['content'].strip().strip("'")
        reply, mentions = targets(text)
        post = {'id': r['tweet_id'], 'handle': r['author'], 'text': text, 'time': t.isoformat() + 'Z',
                'isRepost': r['post_type'] == 'RETWEET', 'isQuote': r['post_type'] == 'QUOTE_TWEET',
                'isReply': bool(reply), 'replyTo': reply, 'mentions': mentions,
                'links': [u for u in (r['tco1_step1'], r['tco2_step1'], r['tco3_step1']) if u],
                'category': r['account_category']}
        for k in hits:
            if IRA_CASES[k][1] <= post['time'][:10] <= IRA_CASES[k][2]:
                out[k].append(post)
    p.wait()
for k, v in out.items():
    json.dump(v, open(os.path.join(work, 'cases', f'ira_{k}.json'), 'w'))
    print('ira', k, len(v))

# --- Sentiment140 (Go et al. 2009): about 1 in 45 of all tweets, Apr–Jun 2009 ------------------
zpath = os.path.join(work, 's140.zip')
if not os.path.exists(zpath):
    subprocess.run(['curl', '-sL', '-o', zpath, 'https://cs.stanford.edu/people/alecmgo/trainingandtestdata.zip'], check=True)
S140_CASES = {  # name: (pattern, first day, last day), US Pacific time as in the file
    'airfrance':    (r'air ?france|flight 447|af ?447', 'Jun 01', 'Jun 04'),
    'farrah':       (r'farrah', 'Jun 25', 'Jun 25'),
    'carradine':    (r'carradine', 'Jun 04', 'Jun 07'),
    'mtvawards':    (r'mtv movie awards|#mtvawards|mtv awards', 'May 30', 'Jun 01'),
    'iran':         (r'\biran', 'Jun 14', 'Jun 21'),
    'squarespace':  (r'squarespace', 'Jun 14', 'Jun 21'),
    'followfriday': (r'#followfriday|#ff\b', 'May 29', 'May 29'),
}
day = lambda d: datetime.datetime.strptime('2009 ' + d, '%Y %b %d').date()
cases = {k: (re.compile(p, re.I), day(a), day(b)) for k, (p, a, b) in S140_CASES.items()}
out = {k: [] for k in S140_CASES}
every = []
with zipfile.ZipFile(zpath) as z, z.open('training.1600000.processed.noemoticon.csv') as f:
    for _, tid, d, _, user, text in csv.reader(io.TextIOWrapper(f, encoding='latin-1')):
        local = datetime.datetime.strptime(d.replace('PDT ', ''), '%a %b %d %H:%M:%S %Y')
        reply, mentions = targets(text)
        post = {'id': tid, 'handle': user, 'text': text, 'time': (local + datetime.timedelta(hours=7)).isoformat() + 'Z',
                'isRepost': bool(re.match(r'\s*RT\b', text, re.I)), 'isReply': bool(reply), 'replyTo': reply,
                'mentions': mentions, 'links': re.findall(r'https?://\S+|\bwww\.\S+', text)}
        every.append(post)
        for k, (pat, a, b) in cases.items():
            if a <= local.date() <= b and pat.search(text):
                out[k].append(post)
for k, v in out.items():
    json.dump(v, open(os.path.join(work, 'cases', f's140_{k}.json'), 'w'))
    print('s140', k, len(v))
json.dump(every, open(os.path.join(work, 'cases', 's140_all.json'), 'w'))
