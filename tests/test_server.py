"""Integration checks for the local launcher; no third-party packages required."""

from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from serve import Handler, ThreadingHTTPServer


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_serves_index_and_referrer_policy(self):
        for path in ("/", "/index.html", "/?test=1"):
            with self.subTest(path=path), urlopen(self.url + path, timeout=5) as response:
                self.assertEqual(response.read(), (ROOT / "index.html").read_bytes())
                self.assertEqual(response.headers["Referrer-Policy"],
                                 "strict-origin-when-cross-origin")
                self.assertEqual(response.headers["Content-Type"], "text/html; charset=utf-8")

    def test_head(self):
        with urlopen(Request(self.url + "/", method="HEAD"), timeout=5) as response:
            self.assertEqual(response.read(), b"")
            self.assertEqual(int(response.headers["Content-Length"]),
                             (ROOT / "index.html").stat().st_size)

    def test_does_not_serve_other_files(self):
        for path in ("/README.md", "/serve.py", "/.git/config", "/../README.md",
                     "/%2e%2e/README.md"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                urlopen(self.url + path, timeout=5)
            self.assertEqual(caught.exception.code, 404)

    def test_launcher_from_another_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "serve.py"), "--no-browser", "--port", "0"],
                cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            # Bound readline if startup regresses and never prints an address.
            timer = threading.Timer(10, process.kill)
            timer.start()
            try:
                line = process.stdout.readline().strip()
                self.assertTrue(line.startswith("Multiwin: http://127.0.0.1:"), line)
                with urlopen(line[len("Multiwin: "):], timeout=5) as response:
                    self.assertEqual(response.read(), (ROOT / "index.html").read_bytes())
            finally:
                timer.cancel()
                process.terminate()
                process.communicate(timeout=5)

    def test_busy_and_invalid_ports_fail_clearly(self):
        for port, message in ((self.server.server_port, "Try --port 0"),
                              (-1, "--port must be between"), (65536, "--port must be between")):
            with self.subTest(port=port):
                result = subprocess.run(
                    [sys.executable, str(ROOT / "serve.py"), "--no-browser", "--port", str(port)],
                    capture_output=True, text=True, timeout=5)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)


if __name__ == "__main__":
    unittest.main()
