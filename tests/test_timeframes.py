import unittest
from datetime import datetime,timezone
from timeframes import interval,bucket,aggregate


class TimeframeTests(unittest.TestCase):
    def test_validation(self):
        for code in ('S1','S45','M45','M1440','H2','H168','D365','W52','MN12'):
            self.assertGreater(interval(code)[1],0)
        for code in ('S0','S61','M1441','H169','MN13','bad','M1.5','M01',None,[],'M99999'):
            with self.subTest(code=code),self.assertRaises(ValueError):interval(code)

    def test_utc_minute_aggregation(self):
        rows=[dict(time=i*60,open=i,high=i+2,low=i-1,close=i+1,tick_volume=3) for i in range(91)]
        bars=aggregate(rows,'M45')
        self.assertEqual(bars[0],[0,0.,46.,-1.,45.,135])
        self.assertEqual(bars[1],[2700000,45.,91.,44.,90.,135])
        self.assertEqual(len(bars),3) # Last, currently forming interval is retained.
        self.assertEqual(aggregate(rows[1:],'M45')[0],bars[1])

    def test_bid_ticks_and_missing_intervals(self):
        rows=[dict(time_msc=t,bid=p) for t,p in [(0,1),(500,2),(2000,3),(3000,0),(4000,float('nan'))]]
        self.assertEqual(aggregate(rows,'S1',ticks=True),[[0,1.,2.,1.,2.,2],[2000,3.,3.,3.,3.,1]])

    def test_calendar_month_and_week_alignment(self):
        stamp=lambda y,m,d:int(datetime(y,m,d,tzinfo=timezone.utc).timestamp())
        self.assertEqual(bucket(stamp(2026,12,31),'MN',12),stamp(2026,1,1))
        self.assertEqual(bucket(stamp(2026,5,15),'MN',3),stamp(2026,4,1))
        self.assertEqual(bucket(stamp(2026,10,31),'W',1),stamp(2026,10,26))
        rows=[dict(time=stamp(2026,m,1),open=m,high=m+2,low=m-1,close=m+1,tick_volume=10) for m in range(1,13)]
        self.assertEqual(aggregate(rows,'MN12'),[[stamp(2026,1,1)*1000,1.,14.,0.,13.,120]])
