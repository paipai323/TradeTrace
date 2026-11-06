import unittest
from journal import setup_results

class SetupResultsTests(unittest.TestCase):
    def test_closed_matching_positions_only_and_deduplicated(self):
        trades=[dict(id='1',entry_order=11,symbol='EURUSD',side='BUY',end=2000,net=-25),dict(id='2',entry_order=22,symbol='XAUUSD',side='SELL',end=3000,net=50)]
        entry=dict(position='1',result=dict(order=11),setup=dict(name='Breakout',rows=[dict(rule='BOS_BULL'),dict(rule='MS_BULL')],automatic_plan=dict(modeled_loss=50)))
        rows=setup_results(trades,[dict(position='2',result=dict(order=99)),entry,entry,dict(position=None,result=dict(order=22))])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['r_multiple'],-.5)
        self.assertEqual(rows[0]['family'],'BOS + MS')
        self.assertEqual(rows[0]['name'],'Breakout')
    def test_missing_and_invalid_risk_never_become_zero_r(self):
        for risk in (None,0,-1,float('nan'),True):
            row=setup_results([dict(id='1',entry_order=11,net=10,end=1000)],[dict(position='1',result=dict(order=11),setup=dict(automatic_plan=dict(modeled_loss=risk)))])[0]
            self.assertIsNone(row['r_multiple'])
    def test_unknown_net_and_order_are_not_inferred(self):
        entry=dict(position='1',result=dict(order=11))
        self.assertEqual(setup_results([dict(id='1',net=3)],[entry]),[])
        row=setup_results([dict(id='1',entry_order=11,net=None)],[entry])[0]
        self.assertIsNone(row['net']);self.assertIsNone(row['r_multiple'])

    def test_overview_keeps_results_isolated_by_account(self):
        import tempfile
        from pathlib import Path
        from journal import Journal
        with tempfile.TemporaryDirectory() as folder:
            journal=Journal(Path(folder)/'journal.sqlite3')
            for login,net in [('1',20),('2',-10)]:
                account=journal.sync(login,'Broker','USD',[dict(id='77',entry_order=11,net=net,end=2000)])
                journal.record_condition_entry('setup-'+login,login,'Broker','USD',dict(result=dict(order=11),setup=dict(name='My setup')))
                rows=journal.overview(account)['setup_results']
                self.assertEqual(len(rows),1);self.assertEqual(rows[0]['net'],net)
            self.assertEqual(journal.overview('["1","Broker"]')['setup_results'][0]['net'],20)
