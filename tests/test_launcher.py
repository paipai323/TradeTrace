import socket
import unittest
from unittest.mock import Mock, patch

from launcher import Launcher


class LauncherTests(unittest.TestCase):
    def test_external_server_is_never_stopped_or_restarted(self):
        launcher=Launcher()
        with patch.object(launcher,'probe',return_value={'version':'1.17.0'}),patch('launcher.subprocess.Popen') as spawn:
            self.assertIn('outside',launcher.start())
            self.assertIn('another',launcher.stop())
            self.assertIn('another',launcher.restart())
            spawn.assert_not_called()

    def test_browser_requires_healthy_server(self):
        launcher=Launcher()
        with patch.object(launcher,'probe',return_value=None),patch('launcher.webbrowser.open') as browser:
            self.assertIn('not ready',launcher.open_browser())
            browser.assert_not_called()
        with patch.object(launcher,'probe',return_value={'version':'1.17.0'}),patch('launcher.webbrowser.open') as browser:
            launcher.open_browser()
            browser.assert_called_once_with(launcher.url)

    def test_busy_stop_does_not_kill_active_request(self):
        import subprocess
        launcher=Launcher();launcher.process=Mock()
        launcher.process.poll.return_value=None
        launcher.process.wait.side_effect=subprocess.TimeoutExpired('server',25)
        self.assertIn('waiting',launcher.stop())
        launcher.process.stdin.write.assert_called_once_with(b'stop\n')
        launcher.process.terminate.assert_not_called()

    def test_managed_server_start_stop_and_restart(self):
        # Real HTTP lifecycle on an isolated port; no MT5 connection or trading API.
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        launcher=Launcher(port)
        try:
            self.assertEqual(launcher.start(),'Server started.')
            first=launcher.process
            self.assertIsNotNone(launcher.probe())
            with socket.create_connection(('127.0.0.1',port),timeout=2) as idle:
                # Browsers speculatively open sockets before sending requests.
                import time
                time.sleep(.1)
                self.assertIsNotNone(launcher.probe(),'idle browser socket must not block health or connection requests')
            self.assertEqual(launcher.start(),'Already running.')
            self.assertEqual(launcher.restart(),'Server started.')
            self.assertIsNotNone(first.poll())
            self.assertIsNot(launcher.process,first)
            self.assertIn('Server stopped',launcher.stop())
            self.assertFalse(launcher.running())
            self.assertIsNone(launcher.probe())
            self.assertIn('Already stopped',launcher.stop())
            self.assertEqual(launcher.start(),'Server started.')
            launcher.process.stdin.close()
            launcher.process.wait(timeout=10)
            self.assertIsNone(launcher.probe(),'closing the console input also stops its server')
        finally:
            launcher.stop()
