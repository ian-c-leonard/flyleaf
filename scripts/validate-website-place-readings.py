"""Check curated place/passages against the exact native book, without copying prose."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json

class Sections(HTMLParser):
    # Inline links and emphasis do not add spaces to the manuscript. Only
    # actual block boundaries separate adjacent rendered text runs.
    boundaries = {'p', 'div', 'section', 'article', 'aside', 'blockquote',
                  'figure', 'figcaption', 'li', 'ul', 'ol', 'table', 'tr',
                  'td', 'th', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

    def __init__(self):
        super().__init__()
        self.current = ''
        self.parts = {}

    def handle_starttag(self, tag, attrs):
        if tag in ('h1', 'h2', 'h3'):
            self.current = dict(attrs).get('id', '')
            if self.current:
                if self.current in self.parts:
                    raise ValueError(f'Duplicate native book heading: {self.current}')
                self.parts[self.current] = []
        if tag in self.boundaries:
            self.handle_data(' ')

    def handle_endtag(self, tag):
        if tag in self.boundaries:
            self.handle_data(' ')

    def handle_data(self, data):
        if self.current:
            self.parts[self.current].append(data)


def validate_readings(html, readings):
    parser = Sections()
    parser.feed(html)
    parser.close()
    for reading in readings:
        text = ' '.join(''.join(parser.parts.get(reading['anchor'], [])).split())
        context = reading.get('requiredContext', [])
        if not isinstance(context, list):
            raise ValueError(f"Malformed book/place context: {reading['anchor']}")
        for witness in [reading['witness'], *context]:
            if not isinstance(witness, str) or not witness.strip() or witness not in text:
                raise ValueError(f"Book/place wording needs review: {reading['anchor']}")


def main():
    # The built site data is in the engine's site folder; the readings are
    # family content.
    import flyleaf_settings
    site = flyleaf_settings.ENGINE / 'website'
    book = json.loads((site / 'public/data/book.json').read_text())['webBook']
    raw = (site / 'public/data' / book['path']).read_bytes()
    if len(raw) != book['bytes'] or hashlib.sha256(raw).hexdigest() != book['sha256']:
        raise ValueError('The native book does not match its recorded bytes and hash.')
    readings = json.loads(flyleaf_settings.content_file('place-readings.json').read_text())
    validate_readings(json.loads(raw)['html'], readings)
    print(f"Checked {len(readings)} place reading{'' if len(readings) == 1 else 's'} against the web book.")


if __name__ == '__main__':
    main()
