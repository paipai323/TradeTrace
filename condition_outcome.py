"""Read-only reconciliation of an exact submitted order with broker history."""
import time


def outcome(terminal, run):
    result=run.get('result') or {}
    base=dict(checked_at=time.time(),order=str(result.get('order') or ''),deal=str(result.get('deal') or ''))
    def report(state,message,**values):return dict(base,state=state,message=message,**values)
    if not result:
        return report('unknown' if run.get('sent') else 'no_order','No recorded broker result. Check MT5; do not resend.' if run.get('sent') else 'No submitted order recorded for this setup. '+run.get('message',''))
    if result.get('retcode') not in (10008,10009,10010):
        return report('rejected',f"Broker did not accept the order ({result.get('retcode')}): {result.get('comment','')}")
    mt,account=terminal.connection()
    if (str(account.login),account.server)!=(str(run['account']),run['server']):raise ValueError('Switch to the setup account and server before checking its trade outcome.')
    order=int(result.get('order') or 0);deal=int(result.get('deal') or 0)
    if not order and not deal:return report('unknown','Broker identifiers are unavailable. Check MT5 history.')
    pending=mt.orders_get(ticket=order) if order else ()
    if pending is None:raise ValueError('Cannot read pending orders from MT5. Try again.')
    if pending:return report('pending','Waiting to fill · pending order remains in MT5.',price=getattr(pending[0],'price_open',None),order_type=getattr(pending[0],'type',None))
    orders=mt.history_orders_get(ticket=order) if order else ()
    if orders is None:raise ValueError('Cannot read broker order history. Try again.')
    deals=mt.history_deals_get(ticket=deal) if deal else ()
    if deals is None:raise ValueError('Cannot read entry deal history. Try again.')
    ids={int(d.position_id) for d in deals if getattr(d,'position_id',0)}
    ids.update(int(o.position_id) for o in orders if getattr(o,'position_id',0))
    if not ids:
        state=getattr(orders[-1],'state',None) if orders else None
        labels={getattr(mt,'ORDER_STATE_CANCELED',2):('cancelled','Pending order cancelled.'),getattr(mt,'ORDER_STATE_EXPIRED',6):('expired','Pending order expired.'),getattr(mt,'ORDER_STATE_REJECTED',5):('rejected','Broker rejected the order.')}
        if state in labels:return report(*labels[state])
        return report('unknown','Accepted request; fill or position linkage is not yet available. Check MT5 or refresh.')
    if len(ids)!=1:return report('unknown','Multiple linked positions. Inspect MT5 history for the complete outcome.')
    pid=ids.pop();positions=mt.positions_get()
    if positions is None:raise ValueError('Cannot read open positions. Try again.')
    linked=[p for p in positions if int(getattr(p,'identifier',p.ticket))==pid]
    history=mt.history_deals_get(position=pid)
    if history is None:raise ValueError('Cannot read linked trade history. Try again.')
    entries=[d for d in history if getattr(d,'entry',None) in (0,2)]
    shared=any(int(getattr(d,'order',0))!=order for d in entries) if order else True
    if shared:return report('shared','Linked position includes other entries or a reversal. Check MT5/journal; profit cannot be attributed to this setup alone.',position=str(pid))
    if linked:return report('open','Position open · floating P/L is not a final result.',position=str(pid),floating=sum(float(p.profit)+float(getattr(p,'swap',0)) for p in linked),currency=account.currency)
    exits=[d for d in history if getattr(d,'entry',None) in (1,3)]
    entered=sum(float(d.volume) for d in entries);exited=sum(float(d.volume) for d in exits)
    if not entries or not exits or abs(entered-exited)>1e-7:return report('unknown','Position is absent, but complete closing deals are not available yet. Refresh or check MT5.',position=str(pid))
    net=sum(float(getattr(d,k,0)) for d in history for k in ('profit','commission','swap','fee'))
    risk=None
    if len(entries)==1 and orders:
        entry=entries[0];sl=float(getattr(orders[0],'sl',0));price=float(getattr(entry,'price',0));side=getattr(entry,'type',None)
        if sl>0 and price>0 and ((side==0 and sl<price) or (side==1 and sl>price)):
            try:
                calculated=mt.order_calc_profit(side,run['symbol'],entered,price,sl)
                if calculated is not None and calculated<0:risk=abs(calculated)
            except Exception:pass
    terminal.bridge.check()
    return report('closed' ,'Closed · '+('profit' if net>0 else 'loss' if net<0 else 'breakeven')+' · net includes commission, swap and fees.',position=str(pid),net=net,currency=account.currency,r_multiple=net/risk if risk else None,initial_risk=risk)
