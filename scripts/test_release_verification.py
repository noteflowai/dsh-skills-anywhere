import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from urllib.error import HTTPError

from verify_npm_release import NAME, verify


class ReleaseVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "release.tgz"
        manifest = json.dumps({"name": NAME, "version": "0.12.1"}).encode()
        with tarfile.open(self.path, "w:gz") as archive:
            entry = tarfile.TarInfo("package/package.json")
            entry.size = len(manifest)
            archive.addfile(entry, io.BytesIO(manifest))
        self.data = self.path.read_bytes()
        self.metadata = {"name": NAME, "version": "0.12.1", "dist": {
            "integrity": "sha512-" + base64.b64encode(hashlib.sha512(self.data).digest()).decode()
        }}

    def reader(self, outcomes):
        outcomes = iter(outcomes)

        def read(url, limit, timeout):
            value = next(outcomes)
            if isinstance(value, Exception):
                raise value
            return value
        return read

    def test_processing_404_then_exact_archive(self):
        result = verify(self.path, delay=0, read=self.reader([
            HTTPError("npm", 404, "processing", {}, None),
            json.dumps(self.metadata).encode(), self.data,
        ]))
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(result["sha256"], hashlib.sha256(self.data).hexdigest())

    def test_digest_mismatch_is_not_retried(self):
        self.metadata["dist"]["integrity"] = "sha512-wrong"
        with self.assertRaisesRegex(ValueError, "integrity differs"):
            verify(self.path, read=self.reader([json.dumps(self.metadata).encode()]))

    def test_archive_mismatch_is_not_retried(self):
        with self.assertRaisesRegex(ValueError, "archive differs"):
            verify(self.path, read=self.reader([json.dumps(self.metadata).encode(), b"changed"]))

    def test_authorization_failure_is_not_retried(self):
        with self.assertRaises(HTTPError):
            verify(self.path, read=self.reader([HTTPError("npm", 403, "denied", {}, None)]))

    def test_unavailable_release_reaches_deadline(self):
        ticks = iter([0, 0, 1])
        with self.assertRaises(TimeoutError):
            verify(self.path, timeout=1, clock=lambda: next(ticks),
                   read=self.reader([HTTPError("npm", 404, "processing", {}, None)]))

    def test_requested_version_must_match(self):
        with self.assertRaisesRegex(ValueError, "requested release"):
            verify(self.path, expected_version="0.12.2", read=self.reader([]))

    def test_registry_definition_must_match(self):
        server = Path(self.temporary.name) / "server.json"
        server.write_text(json.dumps({"name": "io.github.someone/other", "version": "0.12.1"}))
        with self.assertRaisesRegex(ValueError, "MCP definition"):
            verify(self.path, server=server, read=self.reader([]))


if __name__ == "__main__":
    unittest.main()
