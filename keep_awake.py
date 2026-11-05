"""Scoped Windows power requests. Never changes system-wide power settings."""
import ctypes
import json
import os
from pathlib import Path
import threading
import time
import uuid


class WindowsPowerRequest:
    SYSTEM_REQUIRED=1
    EXECUTION_REQUIRED=3

    def __init__(self,reason='TradeTrace: active setup monitoring'):
        if os.name!='nt':raise OSError('Keep-awake requests are available on Windows only.')
        from ctypes import wintypes as w
        class Detailed(ctypes.Structure):
            _fields_=[('module',w.HMODULE),('id',w.ULONG),('count',w.ULONG),('strings',ctypes.POINTER(w.LPWSTR))]
        class Reason(ctypes.Union):
            _fields_=[('detailed',Detailed),('simple',w.LPWSTR)]
        class Context(ctypes.Structure):
            _fields_=[('version',w.ULONG),('flags',w.DWORD),('reason',Reason)]
        class PowerStatus(ctypes.Structure):
            _fields_=[('ac',w.BYTE),('battery_flags',w.BYTE),('battery_percent',w.BYTE),('system_flags',w.BYTE),('life',w.DWORD),('full_life',w.DWORD)]
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        self.kernel.PowerCreateRequest.argtypes=[ctypes.POINTER(Context)];self.kernel.PowerCreateRequest.restype=w.HANDLE
        for name in ('PowerSetRequest','PowerClearRequest'):
            fn=getattr(self.kernel,name);fn.argtypes=[w.HANDLE,ctypes.c_int];fn.restype=w.BOOL
        self.kernel.CloseHandle.argtypes=[w.HANDLE];self.kernel.CloseHandle.restype=w.BOOL
        self.kernel.GetSystemPowerStatus.argtypes=[ctypes.POINTER(PowerStatus)];self.kernel.GetSystemPowerStatus.restype=w.BOOL
        self.context=Context();self.context.version=0;self.context.flags=1;self.context.reason.simple=reason
        self.PowerStatus=PowerStatus;self.handle=None;self.held=[]

    def acquire(self):
        if self.handle is not None:
            if self.held==[self.SYSTEM_REQUIRED,self.EXECUTION_REQUIRED]:return
            self.release()
        handle=self.kernel.PowerCreateRequest(ctypes.byref(self.context))
        if handle is None or handle==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
        self.handle=handle
        try:
            for kind in (self.SYSTEM_REQUIRED,self.EXECUTION_REQUIRED):
                if not self.kernel.PowerSetRequest(handle,kind):raise ctypes.WinError(ctypes.get_last_error())
                self.held.append(kind)
        except Exception:
            self.release();raise

    def release(self):
        if self.handle is None:return
        for kind in reversed(self.held):self.kernel.PowerClearRequest(self.handle,kind)
        if not self.kernel.CloseHandle(self.handle):raise ctypes.WinError(ctypes.get_last_error())
        self.handle=None;self.held=[]

    def power_source(self):
        value=self.PowerStatus()
        if not self.kernel.GetSystemPowerStatus(ctypes.byref(value)):return 'unknown'
        return {0:'battery',1:'ac'}.get(value.ac,'unknown')


class KeepAwake:
    def __init__(self,path=None,backend=None,clock=time.monotonic):
        self.path=Path(path) if path is not None else None;self.backend=backend;self.clock=clock;self.lock=threading.RLock()
        self.enabled=True;self.closed=False;self.requested=False;self.needed=0;self.error='';self.preference_error='';self.last_update=None;self.power_source='unknown'
        if self.path and self.path.exists():
            try:
                data=json.loads(self.path.read_text(encoding='utf-8'))
                if not isinstance(data,dict) or not isinstance(data.get('enabled'),bool):raise ValueError('Invalid preference.')
                self.enabled=data['enabled']
            except Exception:self.preference_error='Saved keep-awake preference unreadable; using enabled.'

    def configure(self,enabled):
        if not isinstance(enabled,bool):raise ValueError('Choose enabled or disabled for keep-awake.')
        with self.lock:
            if self.closed:raise ValueError('Server is shutting down.')
            if self.path:
                self.path.parent.mkdir(parents=True,exist_ok=True);temporary=self.path.with_name(self.path.name+'.tmp-'+uuid.uuid4().hex)
                try:
                    with temporary.open('w',encoding='utf-8') as handle:json.dump(dict(enabled=enabled),handle);handle.flush();os.fsync(handle.fileno())
                    os.replace(temporary,self.path)
                finally:
                    if temporary.exists():temporary.unlink()
            self.enabled=enabled;self.preference_error=''
            return self.update(self.needed)

    def update(self,needed):
        with self.lock:
            self.needed=max(0,int(needed)) if not self.closed else 0;now=self.clock()
            renewed=self.last_update is not None and now-self.last_update>30;self.last_update=now
            try:
                if self.backend is None and os.name=='nt':self.backend=WindowsPowerRequest()
                previous_source=self.power_source
                try:self.power_source=self.backend.power_source() if self.backend is not None else 'unknown'
                except Exception:self.power_source='unknown'
                renewed=renewed or self.power_source!=previous_source
                desired=self.enabled and self.needed>0 and not self.closed
                if self.requested and (not desired or renewed):
                    self.backend.release();self.requested=False
                if desired and not self.requested:
                    if self.backend is None:raise OSError('Keep-awake protection is unavailable on this platform.')
                    self.backend.acquire();self.requested=True
                self.error=''
            except Exception as error:self.error=str(error)
            return self.status()

    def status(self):
        with self.lock:
            if self.error:state='error';message='Keep-awake protection unavailable: '+self.error
            elif not self.enabled:state='off';message='Keep-awake off. Automatic sleep can interrupt monitoring.'
            elif self.closed:state='closed';message='Keep-awake released · the monitoring worker has stopped.'
            elif not self.needed:state='idle';message='Standby allowed · no active setup needs monitoring.'
            elif not self.requested:state='waiting';message='Keep-awake request pending.'
            elif self.power_source=='battery':state='battery';message='Battery power · Windows may suspend monitoring despite keep-awake. Plug in for overnight monitoring.'
            elif self.power_source=='unknown':state='unknown';message='Keep-awake requested · power source unknown. Keep the PC plugged in.'
            else:state='active';message=f'Keeping PC awake · {self.needed} active setup(s). The screen can turn off.'
            return dict(enabled=self.enabled,requested=self.requested,needed=self.needed,state=state,power_source=self.power_source,message=message,preference_error=self.preference_error)

    def close(self):
        with self.lock:self.closed=True;return self.update(0)
