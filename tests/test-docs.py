#!/usr/bin/env python3
"""The docs' commands and versions match what Flyleaf needs."""
import json
import re
import unittest
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent


class QuickStart(unittest.TestCase):
    text = (ENGINE / "docs/quick-start.md").read_text()

    def test_every_command_after_new_names_the_new_family(self):
        family = re.search(r"\./flyleaf new (\S+)", self.text).group(1)
        after = self.text.split(f"./flyleaf new {family}", 1)[1]
        # In code blocks and in running text alike.
        commands = re.findall(r"\./flyleaf (?!--help\b|--version\b|doctor\b|test\b)([^`\n]+)", after)
        self.assertGreater(len(commands), 5)
        for command in commands:
            self.assertIn(f"--family {family}", command, command)

    def test_node_minimum_matches_package_json(self):
        engines = json.loads((ENGINE / "website/package.json").read_text())["engines"]["node"]
        minimum = re.fullmatch(r">=(\d+\.\d+)\.0", engines).group(1)
        for doc in ("docs/quick-start.md", "README.md"):
            found = re.findall(r"Node\.js (\d+(?:\.\d+)*) or later", (ENGINE / doc).read_text())
            self.assertEqual(found, [minimum], doc)


def anchors(markdown):
    """The heading anchors GitHub makes for a Markdown file."""
    seen, found = {}, set()
    in_code = False
    for line in markdown.splitlines():
        if line.startswith("```"):
            in_code = not in_code
        if in_code or not re.match(r"#{1,6} ", line):
            continue
        text = re.sub(r"[^\w\- ]", "", line.lstrip("#").strip().lower()).replace(" ", "-")
        count = seen.get(text, 0)
        seen[text] = count + 1
        found.add(text if count == 0 else f"{text}-{count}")
    return found


class Links(unittest.TestCase):
    def test_every_link_between_the_guides_resolves(self):
        pages = [ENGINE / "README.md", ENGINE / "CONTRIBUTING.md", *sorted((ENGINE / "docs").glob("*.md")),
                 *sorted((ENGINE / "starter").rglob("*.md"))]
        self.assertGreater(len(pages), 10)
        for page in pages:
            text = re.sub(r"```.*?```", "", page.read_text(), flags=re.S)
            for target in re.findall(r"\]\(([^)\s]+)\)", text):
                if re.match(r"[a-z]+:", target):
                    continue
                path, _, anchor = target.partition("#")
                linked = (page.parent / path).resolve() if path else page
                self.assertTrue(linked.exists(), f"{page.relative_to(ENGINE)}: {target}")
                if anchor and linked.suffix == ".md":
                    self.assertIn(anchor, anchors(linked.read_text()),
                                  f"{page.relative_to(ENGINE)}: {target}")


if __name__ == "__main__":
    unittest.main()
