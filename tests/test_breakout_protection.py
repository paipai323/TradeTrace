import unittest,time
import test_automatic_plan
from entry_quality import EntryQualitySkipped

class BreakoutProtectionTests(unittest.TestCase):
 setUp=test_automatic_plan.AutomaticPlanTests.setUp
 def test_buy_signal_low_widens_stop_and_reduces_lots(self):
  old=self.terminal.condition_plan(self.body)['calculation'];self.settings['stop_basis']='SIGNAL';self.body['signal_candle']=dict(low=1.08,high=1.105,time=time.time()-300)
  calc=self.terminal.condition_plan(self.body)['calculation'];self.assertAlmostEqual(calc['sl'],1.0799);self.assertLess(calc['volume'],old['volume']);self.assertLessEqual(calc['modeled_loss'],calc['budget'])
 def test_sell_uses_higher_signal_high(self):
  self.body['side']='SELL';self.body['stop_swing']['price']=1.11;self.settings['stop_basis']='SIGNAL';self.body['signal_candle']=dict(low=1.10,high=1.12,time=time.time()-300)
  calc=self.terminal.condition_plan(self.body)['calculation'];self.assertAlmostEqual(calc['sl'],1.1201);self.assertLessEqual(calc['modeled_loss'],calc['budget'])
 def test_signal_inside_swing_does_not_tighten(self):
  self.settings['stop_basis']='SIGNAL';self.body['signal_candle']=dict(low=1.095,high=1.105,time=time.time()-300)
  self.assertAlmostEqual(self.terminal.condition_plan(self.body)['calculation']['sl'],1.0899)
 def test_missing_signal_rejected(self):
  self.settings['stop_basis']='SIGNAL'
  with self.assertRaisesRegex(ValueError,'signal candle'):self.terminal.condition_plan(self.body)
  self.mt.order_send.assert_not_called()
 def test_buy_requires_bid_above_break(self):
  self.settings['hold_breakout']=True;self.body['retest_level']=self.tick.bid
  with self.assertRaises(EntryQualitySkipped):self.terminal.condition_plan(self.body)
  self.mt.order_send.assert_not_called()
 def test_sell_requires_ask_below_break(self):
  self.body['side']='SELL';self.body['stop_swing']['price']=1.11;self.settings['hold_breakout']=True;self.body['retest_level']=(self.tick.bid+self.tick.ask)/2
  with self.assertRaises(EntryQualitySkipped):self.terminal.condition_plan(self.body)
 def test_rechecked_after_review_and_token_consumed(self):
  self.settings['hold_breakout']=True;self.body['retest_level']=1.099
  preview=self.terminal.condition_plan(self.body);self.tick.bid=1.0989;self.tick.ask=1.099
  with self.assertRaises(EntryQualitySkipped):self.terminal.submit(preview)
  self.mt.order_send.assert_not_called();self.assertNotIn(preview['preview'],self.terminal.previews)
 def test_retest_limit_not_blocked_by_market_hold(self):
  self.settings.update(entry='RETEST',hold_breakout=True);self.body['retest_level']=1.095
  self.assertFalse(self.terminal.condition_plan(self.body)['calculation']['hold_breakout'])
 def test_successful_hold_never_changes_risk_percent(self):
  self.settings['hold_breakout']=True;self.body['retest_level']=1.099
  calc=self.terminal.condition_plan(self.body)['calculation'];self.assertEqual(calc['risk_percent'],1);self.assertTrue(calc['hold_breakout'])

if __name__=='__main__':unittest.main()
