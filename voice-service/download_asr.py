"""Download the official small English Vosk model; no recordings are uploaded."""
from pathlib import Path
import tempfile
import urllib.request
import zipfile

destination = Path(__file__).resolve().parent / 'models'
destination.mkdir(parents=True, exist_ok=True)
model = destination / 'vosk-model-small-en-us-0.15'
if model.is_dir():
    print('Vosk model already installed')
else:
    with tempfile.TemporaryDirectory() as temp:
        archive = Path(temp) / 'model.zip'
        urllib.request.urlretrieve('https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip', archive)
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                target = (destination / entry.filename).resolve()
                if not target.is_relative_to(destination.resolve()):
                    raise ValueError('Unsafe archive path')
            zipped.extractall(destination)
    print('Vosk model installed locally')
