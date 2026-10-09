"""Local speaker embeddings. Requires Python 3.10–3.12; never claims liveness."""
from contextlib import asynccontextmanager
from io import BytesIO
import os
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Request, HTTPException
from speechbrain.inference.speaker import EncoderClassifier

torch.set_num_threads(2)

MODEL = "speechbrain/spkrec-ecapa-voxceleb"
encoder = None

@asynccontextmanager
async def lifespan(app):
    global encoder
    encoder = EncoderClassifier.from_hparams(source=MODEL, savedir=os.path.join(os.path.dirname(__file__), "models", "ecapa"), run_opts={"device": "cpu"})
    yield

app = FastAPI(lifespan=lifespan)

@app.get('/health')
def health():
    return {"ready": encoder is not None, "model": MODEL + ":speechbrain-1.0.3"}

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
