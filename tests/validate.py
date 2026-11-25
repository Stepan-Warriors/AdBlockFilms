import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VALID_RESOURCE_TYPES = {
    "main_frame",
    "sub_frame",
    "stylesheet",
    "script",
    "image",
    "font",
    "object",
    "xmlhttprequest",
    "ping",
    "csp_report",
    "media",
    "websocket",
    "webtransport",
    "webbundle",
    "other",
}


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def assert_file(rel_path):
    clean = rel_path.lstrip("/")
    full = os.path.join(ROOT, clean.replace("/", os.sep))
    if not os.path.isfile(full):
        fail(f"Missing referenced file: {rel_path} ({full})")
    return full


def read_png_size(path):
    with open(path, "rb") as f:
        header = f.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        fail(f"Invalid PNG header: {path}")
    w, h = struct.unpack(">II", header[16:24])
    return w, h


def check_manifest_and_assets():
    manifest_path = assert_file("manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if manifest.get("manifest_version") != 3:
        fail("manifest_version must be 3")

    # Check icons
    for size_key, rel in manifest.get("icons", {}).items():
        p = assert_file(rel)
        w, h = read_png_size(p)
        expected = int(size_key)
        if (w, h) != (expected, expected):
            fail(f"Icon {rel} size is {w}x{h}, expected {expected}x{expected}")

    action = manifest.get("action", {})
    if "default_popup" in action:
        assert_file(action["default_popup"])
    for size_key, rel in action.get("default_icon", {}).items():
        assert_file(rel)

    if "options_page" in manifest:
        assert_file(manifest["options_page"])

    sw = manifest.get("background", {}).get("service_worker")
    if not sw:
        fail("Missing background.service_worker")
    assert_file(sw)

    for cs in manifest.get("content_scripts", []):
        for js in cs.get("js", []):
            assert_file(js)
        for css in cs.get("css", []):
            assert_file(css)

    for war in manifest.get("web_accessible_resources", []):
        for res in war.get("resources", []):
            assert_file(res)

    # Check i18n messages
    raw_manifest = open(manifest_path, "r", encoding="utf-8").read()
    msg_keys = set(re.findall(r"__MSG_([A-Za-z0-9_]+)__", raw_manifest))
    for loc in ("ru", "en"):
        loc_path = assert_file(f"_locales/{loc}/messages.json")
        with open(loc_path, "r", encoding="utf-8") as f:
            loc_data = json.load(f)
        for k in msg_keys:
            if k not in loc_data or not loc_data[k].get("message"):
                fail(f"Locale '{loc}' missing message for '{k}'")

    return manifest


def check_dnr_rules(manifest):
    resources = manifest.get("declarative_net_request", {}).get("rule_resources", [])
    if not resources:
        fail("Missing declarative_net_request.rule_resources")

    for res in resources:
        path = assert_file(res["path"])
        with open(path, "r", encoding="utf-8") as f:
            rules = json.load(f)
        if not isinstance(rules, list) or not rules:
            fail(f"Rules file {res['path']} must be a non-empty list")

        seen_ids = set()
        for rule in rules:
            rid = rule.get("id")
            if not isinstance(rid, int) or rid <= 0:
                fail(f"Invalid rule id: {rid}")
            if rid in seen_ids:
                fail(f"Duplicate rule id: {rid}")
            seen_ids.add(rid)

            action = rule.get("action", {})
            atype = action.get("type")
            if atype not in {"block", "redirect", "allow", "allowAllRequests", "modifyHeaders", "upgradeScheme"}:
                fail(f"Rule {rid} has unsupported action type: {atype}")
            if atype == "redirect":
                ext_path = action.get("redirect", {}).get("extensionPath")
                if not ext_path or not ext_path.startswith("/"):
                    fail(f"Rule {rid} redirect missing leading-slash extensionPath")
                assert_file(ext_path)

            cond = rule.get("condition", {})
            for rt in cond.get("resourceTypes", []):
                if rt not in VALID_RESOURCE_TYPES:
                    fail(f"Rule {rid} invalid resourceType: {rt}")
            if not cond.get("urlFilter") and not cond.get("requestDomains") and not cond.get("regexFilter"):
                fail(f"Rule {rid} has empty match condition")


def check_html_csp():
    for rel in ("src/popup/popup.html", "src/options/options.html"):
        full = assert_file(rel)
        html = open(full, "r", encoding="utf-8").read()
        if re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html, re.I):
            fail(f"Inline <script> violates MV3 CSP in {rel}")
        if re.search(r"\son[a-z]+\s*=", html, re.I):
            fail(f"Inline event handler violates MV3 CSP in {rel}")
        base_dir = os.path.dirname(full)
        for attr_val in re.findall(r'(?:src|href)="([^"]+)"', html):
            if attr_val.startswith(("http://", "https://", "#")):
                fail(f"External or invalid asset ref '{attr_val}' in {rel}")
            target = os.path.normpath(os.path.join(base_dir, attr_val))
            if not os.path.isfile(target):
                fail(f"Missing HTML asset '{attr_val}' referenced in {rel}")


def check_js_files():
    js_files = [
        "src/background/service-worker.js",
        "src/content/ima-stub.js",
        "src/content/page-interceptor.js",
        "src/content/dom-ad-skipper.js",
        "src/popup/popup.js",
        "src/options/options.js",
    ]
    for rel in js_files:
        full = assert_file(rel)
        code = open(full, "r", encoding="utf-8").read()
        if "eval(" in code or "new Function(" in code:
            fail(f"Unsafe dynamic code execution in {rel}")
        if ".innerHTML =" in code and not rel.endswith("options.js"):
            fail(f"Unexpected innerHTML assignment in {rel}")
        # Options.js only assigns '' to clear list
        if rel.endswith("options.js"):
            for m in re.finditer(r"\.innerHTML\s*=\s*([^;]+);", code):
                if m.group(1).strip() not in ("''", '""'):
                    fail(f"Non-empty innerHTML assignment in {rel}: {m.group(0)}")


def main():
    manifest = check_manifest_and_assets()
    check_dnr_rules(manifest)
    check_html_csp()
    check_js_files()
    print("ALL CHECKS PASSED: manifest, icons, locales, DNR rules, CSP HTML, and JS files are valid.")


if __name__ == "__main__":
    main()
