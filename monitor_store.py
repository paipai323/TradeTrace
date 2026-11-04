"""Atomic local setup configuration storage. No credentials or review tokens."""
import json
import os
from pathlib import Path
import shutil
import uuid


class MonitorStore:
    def __init__(self,path):self.path=Path(path);self.read_error=False

    def load(self):
        if not self.path.exists():return dict(records=[],saved_at=None)
        try:
            if self.path.stat().st_size>8*1024*1024:raise ValueError('Saved setup file is too large.')
            data=json.loads(self.path.read_text(encoding='utf-8'),parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Non-finite saved value.')))
            if not isinstance(data,dict) or data.get('version')!=1 or not isinstance(data.get('records'),list) or len(data['records'])>100:raise ValueError('Invalid saved setup format.')
            return data
        except Exception:self.read_error=True;raise

    def save(self,records,saved_at):
        encoded=json.dumps(dict(version=1,saved_at=saved_at,records=records),allow_nan=False,ensure_ascii=False).encode('utf-8')
        if len(encoded)>8*1024*1024:raise ValueError('Saved setups exceed the local storage limit.')
        self.path.parent.mkdir(parents=True,exist_ok=True)
        if self.read_error and self.path.exists():
            shutil.copyfile(self.path,self.path.with_name(self.path.name+'.unreadable-backup-'+uuid.uuid4().hex))
            self.read_error=False
        temporary=self.path.with_name(self.path.name+'.tmp-'+uuid.uuid4().hex)
        try:
            with temporary.open('wb') as handle:handle.write(encoded);handle.flush();os.fsync(handle.fileno())
            os.replace(temporary,self.path)
        finally:
            if temporary.exists():temporary.unlink()
