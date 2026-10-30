import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from journal import Journal
import server


class JournalApiTests(unittest.TestCase):
    def test_authenticated_routes_persist_and_retrieve_review(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            journal=Journal(Path(folder)/'journal.sqlite3')
            account=journal.sync('123','Broker','USD',[dict(id='77',end=5000,net=10)])
            bridge=SimpleNamespace(journal=journal,journal_account=account,stage='journal')
            def post(path,body,token=server.token):
                raw=json.dumps(body).encode()
                handler=server.Handler.__new__(server.Handler)
                handler.path=path;handler.rfile=io.BytesIO(raw)
                handler.headers={'Content-Length':str(len(raw)),'X-Replay-Token':token}
                captured=[];handler.send=lambda value,status=200:captured.append((status,value))
                with patch.object(server,'bridge',bridge):
                    handler.do_POST()
                return captured[0]
            status,result=post('/api/journal/overview',{})
            self.assertEqual(status,200)
            self.assertEqual(result['account'],account)
            self.assertEqual(post('/api/journal/save',dict(account=account,position='77',review={'notes':'Retest entry'}))[0],200)
            self.assertEqual(post('/api/journal/entry',dict(account=account,position='77'))[1]['review']['notes'],'Retest entry')
            self.assertEqual(post('/api/journal/overview',{},token='wrong')[0],403)
            self.assertEqual(post('/api/journal/save',dict(account=account,position='missing',review={}))[0],400)
