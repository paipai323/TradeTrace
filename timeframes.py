"""Validated terminal intervals and UTC aggregation of broker bars / bid ticks."""
import math
import re
from datetime import datetime, timezone

NATIVE = {'M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30',
          'H1','H2','H3','H4','H6','H8','H12','D1','W1','MN1'}
LIMITS = {'S':60,'M':1440,'H':168,'D':365,'W':52,'MN':12}
SECONDS = {'S':1,'M':60,'H':3600,'D':86400,'W':604800,'MN':2629800}


def interval(code):
    match = re.fullmatch(r'(MN|S|M|H|D|W)([1-9][0-9]{0,3})', code) if isinstance(code,str) else None
    if not match or int(match[2]) > LIMITS[match[1]]:
        raise ValueError('Unsupported interval. Choose 1–60 seconds, 1–1440 minutes, 1–168 hours, 1–365 days, 1–52 weeks or 1–12 months.')
    return match[1],int(match[2])


def bucket(timestamp, unit, count):
    if unit == 'MN':
        date=datetime.fromtimestamp(timestamp,timezone.utc)
        month=((date.year-1970)*12+date.month-1)//count*count
        return int(datetime(1970+month//12,month%12+1,1,tzinfo=timezone.utc).timestamp())
    seconds=SECONDS[unit]*count
    origin=345600 if unit=='W' else 0  # Monday 1970-01-05.
    return int((timestamp-origin)//seconds*seconds+origin)


def aggregate(rows, code, ticks=False):
    unit,count=interval(code)
    groups={}
    first=None
    for row in rows:
        timestamp=float(row['time_msc'])/1000 if ticks else int(row['time'])
        if ticks:
            price=float(row['bid'])
            if not math.isfinite(price) or price<=0:continue
            o=h=l=c=price;volume=1
        else:
            o,h,l,c=[float(row[k]) for k in ('open','high','low','close')]
            volume=int(row['tick_volume'])
        start=bucket(timestamp,unit,count)
        if first is None:first=(timestamp,start)
        if start in groups:
            bar=groups[start];bar[2]=max(bar[2],h);bar[3]=min(bar[3],l);bar[4]=c;bar[5]+=volume
        else:groups[start]=[start*1000,o,h,l,c,volume]
    # The source window may begin inside an interval: do not present that as full history.
    if first and first[0]>first[1]:groups.pop(first[1],None)
    return list(groups.values())[-1000:]
