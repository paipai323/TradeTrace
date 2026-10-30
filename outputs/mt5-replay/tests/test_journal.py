import base64
from pathlib import Path
import sqlite3
import tempfile
import unittest
from journal import Journal


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.path=Path(self.folder.name)/'journal.sqlite3'
        self.journal=Journal(self.path)
        self.trade=dict(id='77',symbol='XAUUSD',side='BUY',volume=.1,start=1000,end=5000,
            entry=3990,exit=4000,net=99,reason='Take profit')
        self.account=self.journal.sync('123','Broker','USD',[self.trade])

    def tearDown(self):
        self.folder.cleanup()

    def test_resync_preserves_review_and_restart_retains_data(self):
        review=dict(notes='Entry on retest',lesson='Wait for confirmation',tags=['breakout','breakout'],
            checks={'risk':True},rating=4,reviewed=True)
        self.journal.save(self.account,'77',review)
        self.journal.sync('123','Broker','USD',[dict(self.trade,net=98)])
        entry=Journal(self.path).entry(self.account,'77')
        self.assertEqual(entry['review']['notes'],'Entry on retest')
        self.assertEqual(entry['review']['tags'],['breakout'])
        self.assertEqual(entry['trade']['net'],98)
        self.assertTrue(entry['updated'])
        self.assertEqual(len(self.journal.overview()['trades']),1)

    def test_accounts_and_images_are_isolated(self):
        other=self.journal.sync('123','OtherBroker','USC',[dict(self.trade,net=-20)])
        self.journal.save(self.account,'77',dict(notes='Private review'))
        self.assertEqual(self.journal.entry(other,'77')['review'],{})
        image=self.journal.attach(self.account,'77','setup.png',base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode())
        with self.assertRaises(ValueError):
            self.journal.image(other,image['id'])
        self.journal.remove_image(other,image['id'])
        self.assertTrue(self.journal.image(self.account,image['id'])[0])
        self.journal.remove_image(self.account,image['id'])
        with self.assertRaises(ValueError):
            self.journal.image(self.account,image['id'])

    def test_review_validation_and_attachment_limits(self):
        for review in [dict(notes='x'*20001),dict(rating=7),dict(tags=['x'*41]),dict(checks={'unknown':True})]:
            with self.assertRaises(ValueError):
                self.journal.save(self.account,'77',review)
        with self.assertRaises(ValueError):
            self.journal.attach(self.account,'77','unsafe.svg',base64.b64encode(b'<svg/>').decode())
        for _ in range(8):
            self.journal.attach(self.account,'77','setup.png',base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode())
        with self.assertRaises(ValueError):
            self.journal.attach(self.account,'77','setup.png',base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode())

    def test_backup_contains_reviews_and_screenshots(self):
        self.journal.save(self.account,'77',dict(notes='Saved in backup'))
        self.journal.attach(self.account,'77','setup.png',base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode())
        restored=sqlite3.connect(':memory:')
        restored.deserialize(self.journal.backup())
        self.assertIn('Saved in backup',restored.execute('SELECT review FROM trades').fetchone()[0])
        self.assertEqual(restored.execute('SELECT COUNT(*) FROM images').fetchone()[0],1)
        restored.close()
