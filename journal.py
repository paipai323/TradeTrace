"""Local trade journal, isolated by MT5 account and server."""
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3
import uuid


CHECKS = {'planned', 'risk', 'entry', 'exit'}


def setup_results(trades, entries):
    """One immutable setup association per closed position; never infer unlinked trades."""
    linked={str(trade['id']):trade for trade in trades};seen=set();results=[]
    for item in entries:
        pid=str(item.get('position') or '')
        if pid in seen or pid not in linked:continue
        trade=linked[pid];result=item.get('result') or {};setup=item.get('setup') or {}
        if not trade.get('entry_order') or str(trade['entry_order'])!=str(result.get('order')):continue
        seen.add(pid)
        families=sorted({'BOS' if row.get('rule','').startswith('BOS') else 'MS' for row in setup.get('rows',[]) if row.get('rule','').startswith(('BOS','MS'))})
        net=trade.get('net');risk=(setup.get('automatic_plan') or {}).get('modeled_loss')
        valid_net=isinstance(net,(int,float)) and not isinstance(net,bool) and math.isfinite(net)
        valid_r=valid_net and isinstance(risk,(int,float)) and not isinstance(risk,bool) and math.isfinite(risk) and risk>0
        results.append(dict(position=pid,monitor_id=setup.get('monitor_id'),name=setup.get('name') or 'Unnamed setup',symbol=trade.get('symbol',''),side=trade.get('side',''),end=trade.get('end'),net=net if valid_net else None,r_multiple=net/risk if valid_r else None,family=' + '.join(families) or 'Other'))
    return sorted(results,key=lambda row:row['end'] or 0,reverse=True)


def setup_performance(trades, entries):
    linked={str(trade['id']):trade for trade in trades};seen=set();groups={}
    for item in entries:
        pid=str(item.get('position') or '')
        if pid in seen or pid not in linked:continue
        trade=linked[pid];setup=item.get('setup') or {};result=item.get('result') or {}
        if str(trade.get('entry_order'))!=str(result.get('order')):continue
        seen.add(pid);plan=setup.get('automatic_plan') or {};settings=setup.get('settings') or {};mode=(settings.get('autoPlan') or {}).get('entry') or ('RETEST' if result.get('operation')=='pending' else 'MARKET')
        family=next(('BOS' if row.get('rule','').startswith('BOS') else 'MS' for row in setup.get('rows',[]) if row.get('rule','').startswith(('BOS','MS'))),'Other')
        key=(family,mode);group=groups.setdefault(key,dict(family=family,entry=mode,trades=0,wins=0,net=0.,r_count=0,total_r=0.))
        net=float(trade.get('net',0));group['trades']+=1;group['wins']+=net>0;group['net']+=net
        risk=plan.get('modeled_loss')
        if isinstance(risk,(float,int)) and math.isfinite(risk) and risk>0:group['r_count']+=1;group['total_r']+=net/risk
    for group in groups.values():group.update(win_rate=group['wins']/group['trades']*100,average_r=group['total_r']/group['r_count'] if group['r_count'] else None)
    return sorted(groups.values(),key=lambda group:(group['family'],group['entry']))



class Journal:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(__file__).parent / '.local' / 'journal.sqlite3'

    @contextmanager
    def db(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA foreign_keys=ON')
        con.executescript('''
          CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, login TEXT, server TEXT, currency TEXT);
          CREATE TABLE IF NOT EXISTS trades (
            account TEXT NOT NULL REFERENCES accounts(id), position TEXT NOT NULL,
            snapshot TEXT NOT NULL, review TEXT NOT NULL DEFAULT '{}', updated TEXT,
            PRIMARY KEY(account,position));
          CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY, account TEXT NOT NULL, position TEXT NOT NULL,
            name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL,
            FOREIGN KEY(account,position) REFERENCES trades(account,position));
          CREATE TABLE IF NOT EXISTS drafts (
            account TEXT NOT NULL, position TEXT NOT NULL, review TEXT NOT NULL, updated TEXT NOT NULL, base_updated TEXT,
            PRIMARY KEY(account,position), FOREIGN KEY(account,position) REFERENCES trades(account,position));
          CREATE TABLE IF NOT EXISTS condition_entries (
            id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
            order_ticket TEXT NOT NULL, position TEXT, created TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS condition_entries_account ON condition_entries(account,created);
          CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY,value TEXT);
        ''')
        try:
            with con:
                yield con
        finally:
            con.close()

    def sync(self, login, server, currency, trades, *, select_account=True):
        account = json.dumps([str(login), server], separators=(',', ':'))
        with self.db() as con:
            con.execute('INSERT INTO accounts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET currency=excluded.currency',
                        (account, str(login), server, currency))
            if select_account:con.execute("INSERT INTO settings VALUES ('last_account',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", (account,))
            for trade in trades:
                snapshot = dict(trade, currency=currency)
                if trade.get('entry_order'):
                    con.execute('UPDATE condition_entries SET position=? WHERE account=? AND order_ticket=?',
                                (str(trade['id']), account, str(trade['entry_order'])))
                con.execute('''INSERT INTO trades(account,position,snapshot) VALUES (?,?,?)
                  ON CONFLICT(account,position) DO UPDATE SET snapshot=excluded.snapshot''',
                  (account, str(trade['id']), json.dumps(snapshot, allow_nan=False)))
        return account

    def overview(self, account=None):
        with self.db() as con:
            accounts = [dict(row) for row in con.execute('SELECT * FROM accounts ORDER BY server,login')]
            if not account:
                last = con.execute("SELECT value FROM settings WHERE name='last_account'").fetchone()
                account = last['value'] if last else None
            if account and not any(row['id'] == account for row in accounts):
                raise ValueError('This journal account does not exist.')
            trades = []
            drafts={row['position'] for row in con.execute('SELECT position FROM drafts WHERE account=?',(account,))}
            for row in con.execute('SELECT * FROM trades WHERE account=?', (account,)):
                trades.append(dict(**json.loads(row['snapshot']), review=json.loads(row['review']), updated=row['updated'],has_draft=row['position'] in drafts))
            trades.sort(key=lambda t:t['end'], reverse=True)
            entries = [dict(id=row['id'], position=row['position'], created=row['created'], **json.loads(row['payload']))
                       for row in con.execute('SELECT * FROM condition_entries WHERE account=? ORDER BY created DESC LIMIT 200', (account,))]
            performance_entries=[dict(position=row['position'],**json.loads(row['payload'])) for row in con.execute('SELECT e.position,e.payload FROM condition_entries e JOIN trades t ON t.account=e.account AND t.position=e.position WHERE e.account=? ORDER BY e.created DESC',(account,))]
        return dict(account=account, accounts=accounts, trades=trades, condition_entries=entries,setup_performance=setup_performance(trades,performance_entries),setup_results=setup_results(trades,performance_entries))

    def entry(self, account, position):
        with self.db() as con:
            row = con.execute('SELECT * FROM trades WHERE account=? AND position=?', (account,position)).fetchone()
            if not row:
                raise ValueError('Trade not found in this journal account. Sync MT5 history first.')
            images = [dict(image) for image in con.execute('SELECT id,name,mime FROM images WHERE account=? AND position=?', (account,position))]
            draft=con.execute('SELECT review,updated,base_updated FROM drafts WHERE account=? AND position=?',(account,position)).fetchone()
            saved_draft=dict(review=json.loads(draft['review']),updated=draft['updated'],base_updated=draft['base_updated']) if draft else None
            return dict(trade=json.loads(row['snapshot']), review=json.loads(row['review']), updated=row['updated'], images=images,draft=saved_draft,
                        condition_entries=[dict(id=item['id'], created=item['created'], **json.loads(item['payload']))
                            for item in con.execute('SELECT * FROM condition_entries WHERE account=? AND position=? ORDER BY created', (account,position))])


    def record_condition_entry(self, entry_id, login, server, currency, payload):
        """Store a separate immutable execution snapshot; never create a closed trade or edit a review."""
        encoded=json.dumps(payload, allow_nan=False)
        if len(encoded.encode('utf-8'))>100000:
            raise ValueError('Condition journal record is too large.')
        account=json.dumps([str(login),server],separators=(',', ':'))
        with self.db() as con:
            con.execute('INSERT INTO accounts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET currency=excluded.currency',
                        (account,str(login),server,currency))
            order=str(payload['result']['order'])
            trade=con.execute('SELECT position,snapshot FROM trades WHERE account=?',(account,)).fetchall()
            position=next((row['position'] for row in trade if str(json.loads(row['snapshot']).get('entry_order',''))==order),None) if order!='0' else None
            con.execute('INSERT OR IGNORE INTO condition_entries VALUES (?,?,?,?,?,?)',
                        (entry_id,account,order,position,datetime.now(timezone.utc).isoformat(),encoded))
            # Do not change an existing user's selected journal account.
            con.execute("INSERT OR IGNORE INTO settings VALUES ('last_account',?)",(account,))
        return account

    def unsynced_condition_entries(self, login, server):
        account=json.dumps([str(login),server],separators=(',',':'))
        with self.db() as con:
            rows=con.execute("""SELECT e.id,e.position,e.payload FROM condition_entries e
                LEFT JOIN trades t ON t.account=e.account AND t.position=e.position
                WHERE e.account=? AND t.position IS NULL ORDER BY e.created DESC LIMIT 200""",(account,)).fetchall()
        return [dict(id=row['id'],position=row['position'],**json.loads(row['payload'])) for row in rows]

    def link_condition_position(self, entry_id, login, server, position):
        account=json.dumps([str(login),server],separators=(',',':'))
        with self.db() as con:con.execute('UPDATE condition_entries SET position=? WHERE id=? AND account=?',(str(position),entry_id,account))

    def monitor_history_records(self):
        """Recover immutable accepted condition executions, without touching MT5."""
        with self.db() as con:
            rows=con.execute('SELECT account,payload FROM condition_entries ORDER BY created DESC LIMIT 100').fetchall()
        records=[]
        for row in reversed(rows):
            try:
                payload=json.loads(row['payload']);setup=payload['setup'];result=payload['result'];account,server=json.loads(row['account'])
                if result.get('retcode') not in (10008,10009,10010):continue
                records.append(dict(id=setup['monitor_id'],name=setup.get('name',''),account=str(account),server=server,demo=payload['demo'],symbol=payload['request']['symbol'],settings=setup['settings'],rows=setup['rows'],group=setup.get('group',''),group_policy=setup.get('group_policy','ALL'),invalidation=setup.get('invalidation') or {'enabled':False},started=setup['started'],previous_phase='finished',uncertain=False,
                                    history=dict(phase='finished',result=result,message='Finished execution recovered from journal. Check trade outcome for its current broker status.',sent=True,attempted=True,index=len(setup['rows']))))
            except (KeyError,TypeError,ValueError):continue
        return records

    def clean_review(self, review):
        if not isinstance(review, dict):
            raise ValueError('Invalid journal review.')
        notes = review.get('notes', '')
        lesson = review.get('lesson', '')
        tags = review.get('tags', [])
        checks = review.get('checks', {})
        if not isinstance(notes,str) or len(notes)>20000 or not isinstance(lesson,str) or len(lesson)>4000:
            raise ValueError('Notes support 20,000 characters and lessons support 4,000.')
        if not isinstance(tags,list) or len(tags)>12 or any(not isinstance(tag,str) or len(tag)>40 for tag in tags):
            raise ValueError('Use up to 12 tags, each up to 40 characters.')
        if not isinstance(checks,dict) or any(key not in CHECKS or type(value) is not bool for key,value in checks.items()):
            raise ValueError('Invalid review checklist.')
        rating = review.get('rating', 0)
        if type(rating) is not int or rating not in range(6) or type(review.get('reviewed',False)) is not bool:
            raise ValueError('Choose a process rating from 0 to 5.')
        clean = dict(notes=notes, lesson=lesson, tags=list(dict.fromkeys(tag.strip() for tag in tags if tag.strip())),
                     checks=checks, rating=rating, reviewed=review.get('reviewed',False))
        return clean

    def save(self, account, position, review):
        clean=self.clean_review(review)
        updated = datetime.now(timezone.utc).isoformat()
        with self.db() as con:
            result = con.execute('UPDATE trades SET review=?,updated=? WHERE account=? AND position=?',
                (json.dumps(clean), updated, account, position))
            if result.rowcount != 1:
                raise ValueError('Trade not found in this journal account.')
            con.execute('DELETE FROM drafts WHERE account=? AND position=?',(account,position))
        return dict(review=clean, updated=updated)

    def save_draft(self, account, position, review, base_updated=None):
        clean=self.clean_review(review)
        updated=datetime.now(timezone.utc).isoformat()
        with self.db() as con:
            row=con.execute('SELECT updated FROM trades WHERE account=? AND position=?',(account,position)).fetchone()
            if not row:
                raise ValueError('Trade not found in this journal account.')
            if row['updated'] != base_updated:
                raise ValueError('The saved review changed. Reopen the trade before replacing its draft.')
            con.execute('''INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(account,position)
                DO UPDATE SET review=excluded.review,updated=excluded.updated,base_updated=excluded.base_updated''',
                (account,position,json.dumps(clean),updated,base_updated))
        return dict(updated=updated)

    def attach(self, account, position, name, data):
        try:
            raw = base64.b64decode(data, validate=True)
        except (ValueError, TypeError):
            raise ValueError('Invalid screenshot data.')
        if raw.startswith(b'\x89PNG\r\n\x1a\n'):
            mime = 'image/png'
        elif raw.startswith(b'\xff\xd8\xff'):
            mime = 'image/jpeg'
        elif raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
            mime = 'image/webp'
        else:
            raise ValueError('Choose a PNG, JPEG or WebP screenshot.')
        if len(raw)>3*1024*1024:
            raise ValueError('Screenshots must be smaller than 3 MB.')
        self.entry(account,position)
        identity = uuid.uuid4().hex
        with self.db() as con:
            count = con.execute('SELECT COUNT(*) FROM images WHERE account=? AND position=?',(account,position)).fetchone()[0]
            if count>=8:
                raise ValueError('Each trade supports up to 8 screenshots.')
            con.execute('INSERT INTO images VALUES (?,?,?,?,?,?)', (identity,account,position,str(name)[:120],mime,raw))
        return dict(id=identity,name=str(name)[:120],mime=mime)

    def image(self, account, identity):
        with self.db() as con:
            row=con.execute('SELECT content,mime FROM images WHERE account=? AND id=?',(account,identity)).fetchone()
            if not row:
                raise ValueError('Screenshot not found.')
            return row['content'],row['mime']

    def remove_image(self, account, identity):
        with self.db() as con:
            con.execute('DELETE FROM images WHERE account=? AND id=?',(account,identity))
        return dict(removed=True)

    def backup(self):
        with self.db() as source:
            target = sqlite3.connect(':memory:')
            try:
                source.backup(target)
                return target.serialize()
            finally:
                target.close()
