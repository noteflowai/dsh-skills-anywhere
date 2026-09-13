"""Publish a verified, tested static bundle and read it back anonymously."""
import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

REPO = "glayguo/dsh-skills-anywhere"
FILES = {
    "README.md", ".gitattributes", "LICENSE", "index.html", "style.css",
    "app.js", "data.js", "workspace.json", "thumbnail.png",
}
INJECTION = re.compile(
    rb'(?<=<head>)<script>window\.huggingface=\{variables:\{"SPACE_CREATOR_USER_ID":"[0-9a-f]{24}"\}\};</script>'
)


def verify_bundle(folder, expected_commit):
    folder = Path(folder)
    record = json.loads((folder / "manifest.json").read_text())
    if record.get("schema") != "skills-anywhere-space-1":
        raise ValueError("Unknown bundle schema")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit):
        raise ValueError("Expected a full source commit")
    if record.get("source") != {"commit": expected_commit, "dirty": False}:
        raise ValueError("A clean, matching source commit is required")
    if set(record.get("files", {})) != FILES:
        raise ValueError("Unexpected bundle file list")
    if {p.name for p in folder.iterdir()} != FILES | {"manifest.json"}:
        raise ValueError("Unmanaged files in upload directory")
    for name, item in record["files"].items():
        path = folder / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Expected a regular managed file: {name}")
        data = path.read_bytes()
        if item != {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}:
            raise ValueError(f"Changed bundle file: {name}")
    if sum(item["bytes"] for item in record["files"].values()) > 3_000_000:
        raise ValueError("Static showcase exceeds 3 MB")
    (folder / "index.html").read_bytes().decode("ascii")
    return record


def verify_live(folder, host, timeout=120):
    url = urlsplit(host)
    if (url.scheme != "https" or not (url.hostname or "").endswith(".hf.space")
            or url.username or url.password or url.port or url.path not in ("", "/")
            or url.query or url.fragment):
        raise ValueError("Expected the public Space host")
    pending = {name: (folder / name).read_bytes() for name in
               ["manifest.json", "index.html", "app.js", "data.js", "style.css", "thumbnail.png"]}
    deadline = time.monotonic() + timeout
    errors = {}
    while pending and time.monotonic() < deadline:
        for name in list(pending):
            try:
                request = Request(host.rstrip("/") + "/" + name, headers={"Cache-Control": "no-cache"})
                with urlopen(request, timeout=10) as response:
                    body = response.read(len(pending[name]) + 257)
                if name == "index.html":
                    body = INJECTION.sub(b"", body, count=1)
                if body == pending[name]:
                    del pending[name]
                    errors.pop(name, None)
                else:
                    errors[name] = "served bytes differ"
            except (HTTPError, URLError, TimeoutError) as error:
                errors[name] = type(error).__name__
        if pending:
            time.sleep(min(3, max(0, deadline - time.monotonic())))
    if pending:
        raise ValueError(f"Public app did not match the tested bundle: {errors}")
    return 6


def publish(folder, expected_commit):
    from huggingface_hub import HfApi, SpaceCard
    from huggingface_hub.errors import RepositoryNotFoundError

    folder = Path(folder)
    record = verify_bundle(folder, expected_commit)
    card = SpaceCard.load(folder / "README.md")
    card.validate()
    if card.data.sdk != "static" or card.data.app_file != "index.html":
        raise ValueError("Expected a static Space card")
    api = HfApi()
    if api.whoami()["name"] != REPO.split("/")[0]:
        raise ValueError("Unexpected publishing account")
    try:
        info = api.space_info(REPO)
    except RepositoryNotFoundError:
        api.create_repo(REPO, repo_type="space", space_sdk="static", private=False)
        info = api.space_info(REPO)
    if info.private or info.sdk != "static":
        raise ValueError("Refusing to replace a private or non-static Space")
    previous_files = set(api.list_repo_files(REPO, repo_type="space", revision=info.sha))
    if "manifest.json" in previous_files:
        from huggingface_hub import hf_hub_download
        previous = json.loads(Path(hf_hub_download(REPO, "manifest.json", repo_type="space", revision=info.sha)).read_text())
        if previous.get("schema") != record["schema"]:
            raise ValueError("Existing Space is not this managed showcase")
    elif previous_files - {"README.md", ".gitattributes", "style.css"}:
        raise ValueError("Refusing to overwrite an unrelated Space")
    result = api.upload_folder(
        repo_id=REPO, repo_type="space", folder_path=folder, parent_commit=info.sha,
        commit_message=f"Publish Skills Anywhere showcase from {expected_commit[:12]}",
    )
    revision = result.oid
    public = HfApi(token=False)
    remote = {item.path: item for item in public.list_repo_tree(
        REPO, repo_type="space", revision=revision, recursive=True,
    ) if hasattr(item, "blob_id")}
    for name in FILES | {"manifest.json"}:
        data = (folder / name).read_bytes()
        entry = remote.get(name)
        if entry is None or entry.size != len(data):
            raise ValueError(f"Missing or changed uploaded file: {name}")
        wanted = (hashlib.sha256(data).hexdigest() if entry.lfs else
                  hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data, usedforsecurity=False).hexdigest())
        if wanted != (entry.lfs.sha256 if entry.lfs else entry.blob_id):
            raise ValueError(f"Uploaded bytes differ: {name}")
    info = public.space_info(REPO)
    live_files = verify_live(folder, info.host)
    info = public.space_info(REPO)
    if info.sha != revision or info.private or not info.runtime or info.runtime.stage != "RUNNING":
        raise ValueError("Space changed or is not publicly running after readback")
    return {
        "repo_id": REPO, "source_commit": expected_commit, "hub_commit": revision,
        "url": f"https://huggingface.co/spaces/{REPO}", "app": info.host,
        "verified_files": len(FILES) + 1, "live_files": live_files,
        "unmanaged_files_preserved": sorted(set(remote) - FILES - {"manifest.json"}),
        "anonymous_readback": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    args = parser.parse_args()
    print(json.dumps(publish(args.bundle, args.expected_commit), indent=2))
