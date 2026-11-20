"""Working folders the build makes beside its output, and removes afterwards."""
import shutil
import tempfile
import time
from contextlib import contextmanager


def remove_working_folder(path, attempts=6, pause=0.25):
    """Delete one of the build's working folders.

    macOS can put a .DS_Store into a folder while it is being emptied: an open
    Finder window is enough. The delete then fails with "Directory not empty",
    often after the new output is already in place. So a failed delete is
    tried again, and only the last failure stops the build.
    """
    for attempt in range(attempts):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(pause)


@contextmanager
def working_folder(prefix, parent):
    """A fresh folder under `parent`, removed when the work is over."""
    path = tempfile.mkdtemp(prefix=prefix, dir=parent)
    try:
        yield path
    finally:
        remove_working_folder(path)
