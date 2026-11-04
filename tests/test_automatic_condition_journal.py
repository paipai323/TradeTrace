import tempfile,unittest,threading
from pathlib import Path
from types import SimpleNamespace as NS
from core import Bridge
from journal import Journal
from condition_monitor import ConditionMonitor
from test_core import deal

class AutomaticJournalSyncTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.b=Bridge();self.b.account=123;self.b.server='Demo';self.b.journal=Journal(Path(self.temp.name)/'journal.sqlite3')
  self.opened=True;self.fail=False
  self.entry=deal(43,0,0,order=42);self.exit=deal(44,1,1,order=45,profit=20)
  self.b.mt=NS(account_info=lambda:NS(login=123,server='Demo',currency='USD'),history_orders_get=lambda **k:[NS(position_id=77)],history_deals_get=lambda **k:[self.entry] if 'ticket' in k else [self.entry,self.exit],positions_get=lambda:None if self.fail else [NS(ticket=77,identifier=77)] if self.opened else [])
  self.b.journal.record_condition_entry('setup-entry',123,'Demo','USD',dict(setup={'name':'My setup'},request={'symbol':'EURUSD'},result={'retcode':10009,'order':'42','deal':'43'},demo=True))
 def test_open_links_then_closed_imports_once_with_replay_record(self):
  self.assertEqual(self.b.sync_condition_trades()['waiting'],1)
  overview=self.b.journal.overview();self.assertEqual(overview['trades'],[]);self.assertEqual(overview['condition_entries'][0]['position'],'77')
  self.opened=False;self.assertEqual(self.b.sync_condition_trades()['imported'],1)
  overview=self.b.journal.overview();self.assertEqual(len(overview['trades']),1);self.assertEqual(overview['trades'][0]['net'],19)
  self.assertIn('77',self.b.trades);self.assertEqual(overview['condition_entries'][0]['position'],'77')
  self.assertEqual(self.b.sync_condition_trades()['imported'],0)
 def test_restart_catches_up_from_journal_without_monitor_memory(self):
  self.opened=False;self.b.trades={};self.assertEqual(self.b.sync_condition_trades()['imported'],1)
 def test_other_account_never_imports(self):
  self.b.mt.account_info=lambda:NS(login=456,server='Demo',currency='USD')
  with self.assertRaises(ValueError):self.b.sync_condition_trades()
  self.assertEqual(self.b.journal.overview()['trades'],[])
 def test_failure_is_retryable_and_never_fakes_closed_trade(self):
  self.fail=True
  with self.assertRaises(ValueError):self.b.sync_condition_trades()
  self.assertEqual(self.b.journal.overview()['trades'],[])
  self.fail=False;self.opened=False;self.assertEqual(self.b.sync_condition_trades()['imported'],1)
 def test_unsupported_shared_or_partial_trade_not_imported(self):
  self.opened=False;self.exit.volume=.05
  self.assertEqual(self.b.sync_condition_trades()['unsupported'],1);self.assertEqual(self.b.journal.overview()['trades'],[])
 def test_background_worker_throttles_and_retries(self):
  clock=[100];calls=[]
  bridge=NS(sync_condition_trades=lambda:calls.append(1) or dict(imported=0))
  monitor=ConditionMonitor(NS(bridge=bridge),threading.RLock(),lambda:clock[0])
  monitor.tick();monitor.tick();self.assertEqual(len(calls),1)
  clock[0]+=10;monitor.tick();self.assertEqual(len(calls),2)
 def test_preserves_other_selected_journal_account(self):
  other=self.b.journal.sync(456,'Other','USD',[]);self.opened=False;self.b.sync_condition_trades()
  self.assertEqual(self.b.journal.overview()['account'],other)

if __name__=='__main__':unittest.main()
