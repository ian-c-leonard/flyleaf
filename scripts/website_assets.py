"""Shared publication boundary for held reader files, not support metadata."""
from pathlib import Path, PureWindowsPath
import re

import flyleaf_settings


STRUCTURED_READER_KINDS = {
    '.json': {'record-index', 'record-extraction', 'catalogue-record', 'research-note', 'search-capture'},
    '.xml': {'finding-aid'},
    '.md': {'research-note', 'transcription'},
}
REVIEWED_READER_KINDS = set().union(*STRUCTURED_READER_KINDS.values()) | {
    'document', 'photograph', 'newspaper-page', 'yearbook-page', 'book',
    'web-page', 'book-illustration', 'audio-recording',
}
# HEIC/HEIF originals are downloadable evidence. A separately declared
# JPEG display derivative supplies the portable browser preview.
READER_FORMATS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.heic', '.heif',
                  '.pdf', '.epub', '.txt', '.html', '.htm',
                  # Music: listening copies, then originals (docs/family-folder.md).
                  '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.aif', '.aiff'}
# Files a browser would open as a page, with its scripts, if a public host
# served them under their own names. A static site publishes them as text.
PAGE_FORMATS = {'.html', '.htm', '.xhtml', '.svg', '.xml'}


# Folder names that hold working files unless a family names its own,
# including those earlier versions of Flyleaf always left out.
RESEARCH_FOLDERS = ['research', 'review', 'working', 'capture', 'captures', 'correlation',
                    'independent-reading']


def research_folders():
    """Folder names whose files are research working files, not originals for
    readers (site.research_folders in flyleaf.json). The site leaves them out
    unless the tree gives the file a _KIND and a _SHA256."""
    names = flyleaf_settings.get('site.research_folders', RESEARCH_FOLDERS)
    if not isinstance(names, list) or not all(isinstance(n, str) and n for n in names):
        raise SystemExit('flyleaf.json: site.research_folders must be a list of folder names')
    return {name.lower() for name in names}


def skip_reason(value, kind='', *, reviewed=False):
    """Why the site leaves this file out, in plain words; None when it may go in.

    Callers may set reviewed only when they also validate the declared file hash.
    Untyped discovery keeps its conservative directory boundary in every case.
    """
    text = value.replace('\\', '/')
    parts = Path(text).parts
    if any('credential' in part.lower() or part.lower() in {'secrets', 'private'} or part.startswith('.env') for part in parts):
        raise ValueError('A private configuration file cannot be an archive asset')
    images = flyleaf_settings.folder_name('images')
    if re.match(r'^[a-zA-Z]:[\\/]', value) or value.startswith('\\\\') or PureWindowsPath(value).drive:
        return f'a path on a Windows computer; copy the file into {images}/ and point the tree at it'
    if Path(text).is_absolute():
        return f'a path on one computer; copy the file into {images}/ and point the tree at it'
    if not parts or parts[0] != images:
        return f'not inside {images}/'
    if any(part.startswith('.') for part in parts):
        return 'a hidden file or folder'
    suffix = Path(text).suffix.lower()
    if suffix in STRUCTURED_READER_KINDS and kind not in STRUCTURED_READER_KINDS[suffix]:
        return f'a {suffix} file shows only with a _KIND such as ' + \
            ', '.join(sorted(STRUCTURED_READER_KINDS[suffix]))
    if suffix not in READER_FORMATS and suffix not in STRUCTURED_READER_KINDS:
        return f'the site cannot show {suffix or "files without an extension"}'
    if not (reviewed and kind in REVIEWED_READER_KINDS):
        folder = next((part for part in parts if part.lower() in research_folders()), None)
        if folder:
            return f'in the research folder "{folder}" (site.research_folders)'
    return None


def reader_asset(value, kind='', *, reviewed=False):
    """Admit held reader formats; explicit typed/hash-bound files may use research folders."""
    return skip_reason(value, kind, reviewed=reviewed) is None
