import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from journal import Journal
import test_terminal


class ConditionJournalTests(unittest.TestCase):
    def setUp(self):
        test_terminal.TerminalTests.setUp(self)
        self.folder=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.folder.cleanup)
        self.journal=Journal(Path(self.folder.name)/'journal.sqlite3')
        self.terminal.bridge.journal=self.journal
        self.setup=dict(started=1000,completed=2000,action='AUTO',rows=[dict(rule='TRADED_ABOVE',mode='LIVE',level=1.099)],
                        observations=[dict(type='passed',index=0,observed_at=1500,bid=1.1)],settings=dict(sizing='MANUAL',timeout='0',gap='300'))
        self.body.update(condition_entry=True,expected_account='123',expected_server='Demo',condition_setup=self.setup)

    def test_snapshot_saved_after_send_frozen_and_linked_without_overwriting_review(self):
        preview=self.terminal.preview(self.body)
        self.assertEqual(self.journal.overview()['condition_entries'],[])
        self.setup['rows'][0]['level']=2
        sent=self.terminal.submit(preview)
        self.assertTrue(sent['journal_recorded'])
        overview=self.journal.overview()
        self.assertEqual(overview['trades'],[],'An entry is not a closed trade')
        entry=overview['condition_entries'][0]
        self.assertEqual(entry['setup']['rows'][0]['level'],1.099)
        self.assertIsNone(entry['position'])
        trade=dict(id='900',entry_order=42,symbol='EURUSD',end=4000,net=10)
        account=self.journal.sync('123','Demo','USD',[trade])
        self.journal.save(account,'900',dict(notes='My review'))
        self.journal.save_draft(account,'900',dict(notes='My unfinished draft'),self.journal.entry(account,'900')['updated'])
        self.journal.sync('123','Demo','USD',[trade])
        saved=Journal(self.journal.path).entry(account,'900')
        self.assertEqual(len(saved['condition_entries']),1)
        self.assertEqual(saved['review']['notes'],'My review')
        self.assertEqual(saved['draft']['review']['notes'],'My unfinished draft')
        other=self.journal.sync('123','Other','USD',[trade])
        self.assertEqual(self.journal.overview(other)['condition_entries'],[])
        self.assertEqual(self.journal.entry(other,'900')['condition_entries'],[])
        with self.assertRaises(ValueError):self.terminal.submit(preview)
        self.mt.order_send.assert_called_once()

    def test_pending_acceptance_logged_as_pending_without_a_position(self):
        self.setup['action']='REVIEW'
        self.body.update(order_kind='LIMIT',price=1.09,sl=1.08,tp=1.11)
        self.mt.order_send.return_value.retcode=10008
        self.mt.order_send.return_value.deal=0
        result=self.terminal.submit(self.terminal.preview(self.body))
        self.assertTrue(result['journal_recorded'])
        item=self.journal.overview()['condition_entries'][0]
        self.assertEqual(item['result']['operation'],'pending')
        self.assertEqual(item['setup']['action'],'REVIEW')
        self.assertIsNone(item['position'])

    def test_journal_failure_does_not_hide_execution_or_allow_retry(self):
        self.terminal.bridge.journal=Mock()
        self.terminal.bridge.journal.record_condition_entry.side_effect=OSError('disk full')
        preview=self.terminal.preview(self.body)
        result=self.terminal.submit(preview)
        self.assertEqual(result['retcode'],10009)
        self.assertFalse(result['journal_recorded'])
        self.assertIn('do not resend',result['journal_warning'])
        with self.assertRaises(ValueError):self.terminal.submit(preview)
        self.mt.order_send.assert_called_once()

    def test_rejected_and_manual_orders_are_not_recorded(self):
        self.mt.order_send.return_value.retcode=10016
        self.terminal.submit(self.terminal.preview(self.body))
        self.assertEqual(self.journal.overview()['condition_entries'],[])
        self.body.pop('condition_entry')
        self.mt.order_send.return_value.retcode=10009
        self.terminal.submit(self.terminal.preview(self.body))
        self.assertEqual(self.journal.overview()['condition_entries'],[])

    def test_invalid_snapshot_rejected_before_send(self):
        self.body['condition_setup']={'rows':'invalid'}
        with self.assertRaisesRegex(ValueError,'snapshot|rows'):self.terminal.preview(self.body)
        self.mt.order_send.assert_not_called()
