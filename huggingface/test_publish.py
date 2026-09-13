import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("showcase_publish", Path(__file__).with_name("publish.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commit = "a" * 40
        files = {}
        for name in module.FILES:
            data = b"<head></head>" if name == "index.html" else b"fixture"
            (self.root / name).write_bytes(data)
            files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        self.record = {"schema": "skills-anywhere-space-1", "source": {"commit": self.commit, "dirty": False}, "files": files}
        self.write()

    def write(self):
        (self.root / "manifest.json").write_text(json.dumps(self.record))

    def test_clean_exact_bundle(self):
        self.assertEqual(module.verify_bundle(self.root, self.commit), self.record)

    def test_changed_file_and_unmanaged_file_are_rejected(self):
        (self.root / "extra.txt").write_text("must not be uploaded")
        with self.assertRaisesRegex(ValueError, "Unmanaged"):
            module.verify_bundle(self.root, self.commit)
        (self.root / "extra.txt").unlink()
        (self.root / "app.js").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Changed"):
            module.verify_bundle(self.root, self.commit)

    def test_dirty_and_wrong_source_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "matching"):
            module.verify_bundle(self.root, "b" * 40)
        self.record["source"]["dirty"] = True
        self.write()
        with self.assertRaisesRegex(ValueError, "clean"):
            module.verify_bundle(self.root, self.commit)

    def test_paths_cannot_extend_the_allowlist(self):
        self.record["files"]["../private.txt"] = {"bytes": 0, "sha256": "0" * 64}
        self.write()
        with self.assertRaisesRegex(ValueError, "file list"):
            module.verify_bundle(self.root, self.commit)

    def test_only_known_static_injection_is_normalized(self):
        valid = b'<head><script>window.huggingface={variables:{"SPACE_CREATOR_USER_ID":"' + b"a" * 24 + b'"}};</script></head>'
        self.assertEqual(module.INJECTION.sub(b"", valid), b"<head></head>")
        extra = b'<head><script>alert("unexpected")</script></head>'
        self.assertEqual(module.INJECTION.sub(b"", extra), extra)


if __name__ == "__main__":
    unittest.main()
