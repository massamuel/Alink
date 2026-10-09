"""Local speaker embeddings. Requires Python 3.10–3.12; never claims liveness."""
from contextlib import asynccontextmanager
from io import BytesIO
import os
import json
import wave
from pathlib import Path
from vosk import Model, KaldiRecognizer
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Request, HTTPException
from speechbrain.inference.speaker import EncoderClassifier

torch.set_num_threads(2)

MODEL = "speechbrain/spkrec-ecapa-voxceleb"
encoder = None
asr_model = None

@asynccontextmanager
async def lifespan(app):
    global encoder, asr_model
    encoder = EncoderClassifier.from_hparams(source=MODEL, savedir=os.path.join(os.path.dirname(__file__), "models", "ecapa"), run_opts={"device": "cpu"})
    model_path = Path(os.environ.get("VOSK_MODEL_PATH", str(Path(__file__).parent / "models" / "vosk-model-small-en-us-0.15")))
    if model_path.is_dir():
        asr_model = Model(str(model_path))
    yield

app = FastAPI(lifespan=lifespan)

@app.get('/health')
def health():
    return {"ready": encoder is not None, "transcriptionReady": asr_model is not None, "model": MODEL + ":speechbrain-1.0.3"}

@app.post('/embed')
async def embed(request: Request):
    if request.headers.get('content-type') != 'audio/wav':
        raise HTTPException(415, 'PCM WAV required')
    if int(request.headers.get('content-length', '0')) > 2_000_000:
        raise HTTPException(413, 'Recording too large')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 2_000_000:
            raise HTTPException(413, 'Recording too large')
    try:
        signal, rate = sf.read(BytesIO(data), dtype='float32')
        if signal.ndim != 1 or rate != 16000 or not 2 <= len(signal)/rate <= 30:
            raise ValueError('Mono 16 kHz audio, 2–30 seconds required')
        if not np.isfinite(signal).all() or np.sqrt(np.mean(signal**2)) < 0.003:
            raise ValueError('Recording unusable')
        with torch.inference_mode():
            embedding = encoder.encode_batch(torch.from_numpy(signal).unsqueeze(0)).flatten().tolist()
        return {"embedding": embedding, "model": MODEL + ":speechbrain-1.0.3"}
    except Exception:
        raise HTTPException(422, 'Recording could not be processed')


@app.post('/transcribe')
async def transcribe(request: Request):
    if asr_model is None:
        raise HTTPException(503, 'Install the local Vosk model and restart the voice service')
    if request.headers.get('content-type') != 'audio/wav':
        raise HTTPException(415, 'PCM WAV required')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 2_000_000:
            raise HTTPException(413, 'Recording too large')
    try:
        with wave.open(BytesIO(data), 'rb') as recording:
            if recording.getnchannels() != 1 or recording.getsampwidth() != 2 or recording.getframerate() != 16000 or not 2 <= recording.getnframes()/16000 <= 30:
                raise ValueError('Mono 16 kHz PCM, 2–30 seconds required')
            pcm = recording.readframes(recording.getnframes())
        recognizer = KaldiRecognizer(asr_model, 16000)
        # Unrestricted recognition: never supply the expected phrase as grammar/prompt.
        texts = []
        for offset in range(0, len(pcm), 8000):
            if recognizer.AcceptWaveform(pcm[offset:offset+8000]):
                texts.append(json.loads(recognizer.Result()).get('text', ''))
        texts.append(json.loads(recognizer.FinalResult()).get('text', ''))
        return {'text': ' '.join(t for t in texts if t), 'model': 'vosk-model-small-en-us-0.15'}
    except Exception:
        raise HTTPException(422, 'Transcription could not be processed')
