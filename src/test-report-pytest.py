"""Read a JUnit XML test report with the Python standard library."""
import json
import sys
import xml.etree.ElementTree as ET


class NoDoctype(ET.TreeBuilder):
    def doctype(self, name, public_id, system_id):
        raise ValueError("JUnit XML must not contain a DOCTYPE")


root = ET.parse(sys.argv[1], parser=ET.XMLParser(target=NoDoctype())).getroot()
if root.tag not in ("testsuite", "testsuites"):
    raise ValueError("Expected a JUnit testsuite or testsuites root")

print(json.dumps({
    "suites": [suite.attrib for suite in root.iter("testsuite")],
    "cases": [{
        **case.attrib,
        "observations": [
            {"tag": child.tag, "message": child.get("message"), "text": "".join(child.itertext())}
            for child in case if child.tag in ("failure", "error", "skipped", "system-out", "system-err")
        ],
    } for case in root.iter("testcase")],
}))
