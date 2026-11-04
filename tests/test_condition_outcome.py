import unittest
from types import SimpleNamespace as NS
from condition_outcome import outcome

class OutcomeTests(unittest.TestCase):
 def setUp(self):
  self.run=dict(account='123',server='Demo',symbol='EURUSD',result=dict(retcode=10009,order='10',deal='20'))
  self.entry=NS(position_id=30,entry=0,order=10,volume=1,profit=0,commission=-2,swap=0,fee=0,type=0,price=100)
  self.exit=NS(position_id=30,entry=1,order=11,volume=1,profit=50,commission=-2,swap=-1,fee=0)
  self.pending=();self.orders=(NS(position_id=30,sl=90),);self.positions=();self.history=(self.entry,self.exit)
  self.mt=NS(orders_get=lambda **k:self.pending,history_orders_get=lambda **k:self.orders,positions_get=lambda:self.positions,history_deals_get=lambda **k:(self.entry,) if 'ticket' in k else self.history,order_calc_profit=lambda *a:-10)
  self.terminal=NS(connection=lambda:(self.mt,NS(login=123,server='Demo',currency='USD')),bridge=NS(check=lambda:None))
 def test_closed_net_and_rr(self):
  result=outcome(self.terminal,self.run);self.assertEqual(result['state'],'closed');self.assertEqual(result['net'],45);self.assertEqual(result['r_multiple'],4.5)
 def test_pending(self):
  self.pending=(NS(ticket=10),);self.assertEqual(outcome(self.terminal,self.run)['state'],'pending')
 def test_open_partial_close_not_final(self):
  self.positions=(NS(ticket=30,identifier=30,profit=22,swap=-1),);result=outcome(self.terminal,self.run);self.assertEqual(result['state'],'open');self.assertEqual(result['floating'],21);self.assertNotIn('net',result)
 def test_other_account_rejected(self):
  self.run['account']='456'
  with self.assertRaises(ValueError):outcome(self.terminal,self.run)
 def test_shared_netting_position(self):
  self.history+=(NS(entry=0,order=12,volume=1),);self.assertEqual(outcome(self.terminal,self.run)['state'],'shared')
 def test_missing_closing_deals_not_closed(self):
  self.history=(self.entry,);self.assertEqual(outcome(self.terminal,self.run)['state'],'unknown')
 def test_expired_cancelled_rejected(self):
  self.run['result']['deal']='0'
  for state,label in [(2,'cancelled'),(6,'expired'),(5,'rejected')]:
   self.orders=(NS(position_id=0,state=state),);self.assertEqual(outcome(self.terminal,self.run)['state'],label)
 def test_no_result_and_rejection(self):
  self.run['result']=None;self.assertEqual(outcome(self.terminal,self.run)['state'],'no_order')
  self.run['sent']=True;self.assertEqual(outcome(self.terminal,self.run)['state'],'unknown')
  self.run['result']=dict(retcode=10013);self.assertEqual(outcome(self.terminal,self.run)['state'],'rejected')
 def test_read_failure_not_a_loss(self):
  self.pending=None
  with self.assertRaises(ValueError):outcome(self.terminal,self.run)
 def test_rr_unavailable_without_original_sl(self):
  self.orders=(NS(position_id=30),);self.assertIsNone(outcome(self.terminal,self.run)['r_multiple'])

if __name__=='__main__':unittest.main()
