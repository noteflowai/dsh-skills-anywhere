"""Wait for this project's public npm release and verify the published tarball."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


NAME = "dsh-skills-anywhere"
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?")
RETRY_CODES = {404, 408, 429, 500, 502, 503, 504}


def fetch(url, limit, timeout):
    with urlopen(url, timeout=timeout) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("registry response exceeds the expected size")
    return data


def verify(path, *, expected_version=None, server=None, timeout=300, delay=15,
           read=fetch, clock=time.monotonic, sleep=time.sleep):
    if timeout <= 0 or delay < 0:
        raise ValueError("timeout must be positive and delay nonnegative")
    data = Path(path).read_bytes()
    if len(data) > 16 * 1024 * 1024:
        raise ValueError("release archive exceeds 16 MiB")
    with tarfile.open(path, "r:gz") as archive:
        manifests = [m for m in archive.getmembers() if m.name == "package/package.json"]
        if len(manifests) != 1 or not manifests[0].isfile() or manifests[0].size > 65536:
            raise ValueError("expected one regular package manifest")
        package = json.load(archive.extractfile(manifests[0]))
    version = package["version"]
    if package["name"] != NAME or not VERSION.fullmatch(version):
        raise ValueError("unexpected package identity")
    if expected_version is not None and version != expected_version:
        raise ValueError("archive does not match the requested release")
    if server is not None:
        definition = json.loads(Path(server).read_text())
        entries = definition.get("packages", [])
        if (definition.get("name") != f"io.github.noteflowai/{NAME}"
                or definition.get("version") != version or len(entries) != 1
                or entries[0].get("registryType") != "npm"
                or entries[0].get("identifier") != NAME
                or entries[0].get("version") != version):
            raise ValueError("MCP definition does not match the release archive")
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    metadata_url = f"https://registry.npmjs.org/{NAME}/{version}"
    tarball_url = f"https://registry.npmjs.org/{NAME}/-/{NAME}-{version}.tgz"
    deadline, attempts = clock() + timeout, 0
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError("npm release did not become verifiable before the deadline")
        attempts += 1
        try:
            metadata = json.loads(read(metadata_url, 1024 * 1024, min(20, remaining)))
            if (metadata.get("name") != NAME or metadata.get("version") != version
                    or metadata.get("dist", {}).get("integrity") != integrity):
                raise ValueError("published npm identity or integrity differs from the release")
            remaining = deadline - clock()
            if remaining <= 0:
                raise TimeoutError("npm verification deadline reached")
            remote = read(tarball_url, len(data), min(20, remaining))
            if remote != data:
                raise ValueError("public npm archive differs from the GitHub release archive")
            return {"name": NAME, "version": version, "integrity": integrity,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": len(data), "attempts": attempts}
        except HTTPError as error:
            if error.code not in RETRY_CODES:
                raise
            reason = f"HTTP {error.code}"
        except (URLError, TimeoutError) as error:
            reason = type(error).__name__
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError("npm release did not become verifiable before the deadline")
        print(f"npm readback attempt {attempts}: {reason}; waiting within deadline",
              file=sys.stderr)
        sleep(min(delay, remaining))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--expected-version")
    parser.add_argument("--server", type=Path)
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    print(json.dumps(verify(args.archive, expected_version=args.expected_version,
                            server=args.server, timeout=args.timeout), indent=2))
