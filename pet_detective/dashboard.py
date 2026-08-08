from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from .pipeline import PetPipeline
from .sources import youtube_embed_url
from .storage import EventStore
from .video import analyse_video

app = FastAPI(title="AI Pet Detective")
UPLOAD_DIR = Path("data/uploads")
DB_PATH = "data/pet_detective.db"
jobs: dict[str, dict] = {}


def process_video(session_id: str, source: str | Path, use_qvac: bool, semantic_every: int,
                  source_label: str | None = None) -> None:
    label = source_label or (source.name if isinstance(source, Path) else source)
    jobs[session_id] = {"status": "processing", "source": label, "events": [], "states": {}}
    def progress(update: dict) -> None:
        job = jobs[session_id]
        job.update({key: value for key, value in update.items() if key != "events"})
        if update["events"]:
            job["events"] = (job["events"] + update["events"])[-20:]
    try:
        result = analyse_video(
            str(source), session_id, PetPipeline(EventStore(DB_PATH)),
            use_qvac=use_qvac, sample_seconds=semantic_every, on_progress=progress,
        )
        jobs[session_id] = {"status": "complete", "source": label, "report": result}
    except Exception as exc:
        jobs[session_id] = {"status": "failed", "source": label, "error": str(exc)}

@app.get("/api/sessions/{session_id}")
def session(session_id: str):
    return EventStore(DB_PATH).report(session_id)


@app.get("/api/jobs/{session_id}")
def job(session_id: str):
    if session_id not in jobs:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    return {"session_id": session_id, **jobs[session_id]}


class SourceRequest(BaseModel):
    use_qvac: bool = False
    semantic_every: int = 15


class YouTubeRequest(SourceRequest):
    url: str


def validate_interval(seconds: int) -> None:
    if not 1 <= seconds <= 3600:
        raise HTTPException(status_code=422, detail="Il controllo Vision deve essere tra 1 e 3600 secondi")


@app.post("/api/camera")
def start_camera(request: SourceRequest, background_tasks: BackgroundTasks):
    validate_interval(request.semantic_every)
    session_id = f"camera-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid4().hex[:6]}"
    jobs[session_id] = {"status": "queued", "source": "Camera locale"}
    background_tasks.add_task(process_video, session_id, "0", request.use_qvac, request.semantic_every, "Camera locale")
    return {"session_id": session_id, "status": "queued"}


@app.post("/api/youtube")
def start_youtube(request: YouTubeRequest, background_tasks: BackgroundTasks):
    validate_interval(request.semantic_every)
    try:
        embed_url = youtube_embed_url(request.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session_id = f"youtube-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid4().hex[:6]}"
    jobs[session_id] = {"status": "queued", "source": request.url}
    background_tasks.add_task(process_video, session_id, request.url, request.use_qvac, request.semantic_every, request.url)
    return {"session_id": session_id, "status": "queued", "embed_url": embed_url}


@app.post("/api/videos")
async def upload_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    use_qvac: bool = False,
    semantic_every: int = 15,
):
    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov", ".m4v", ".avi", ".mkv"}:
        raise HTTPException(status_code=415, detail="Carica un video MP4, MOV, M4V, AVI o MKV")
    validate_interval(semantic_every)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    session_id = f"iphone-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid4().hex[:6]}"
    destination = UPLOAD_DIR / f"{session_id}{suffix}"
    with destination.open("wb") as saved:
        while chunk := await video.read(1024 * 1024):
            saved.write(chunk)
    await video.close()
    jobs[session_id] = {"status": "queued", "source": destination.name}
    background_tasks.add_task(process_video, session_id, destination, use_qvac, semantic_every)
    return {"session_id": session_id, "status": "queued"}

@app.get("/", response_class=HTMLResponse)
def home():
    return '''<!doctype html><meta charset="utf-8"><title>AI Pet Detective</title>
<style>body{max-width:900px;margin:36px auto;font:16px system-ui;color:#17202a;padding:0 16px}.modes{display:flex;gap:8px;margin:16px 0}.modes button{margin:0}.modes .active{background:#1677c8;color:white}.panel{display:none}.panel.active{display:block}#drop{border:2px dashed #6d7b8d;border-radius:12px;padding:30px;text-align:center;cursor:pointer;display:block}.over{background:#edf6ff;border-color:#1677c8!important}button{padding:9px 14px;margin-top:12px}input{padding:8px;box-sizing:border-box}.url{width:100%}.hidden{display:none}.live{display:grid;grid-template-columns:1.15fr 1fr;gap:20px;margin-top:24px}video,iframe{width:100%;aspect-ratio:16/9;background:#111;border:0;border-radius:12px}.card,pre{background:#f4f6f8;padding:16px;border-radius:12px}.bar{height:10px;background:#dce3e9;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#1677c8}.event{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #dce3e9;background:none;padding:8px 0;margin:0;cursor:pointer}.event:hover{color:#1677c8}pre{white-space:pre-wrap}@media(max-width:700px){.live{grid-template-columns:1fr}}</style>
<main><h1>AI Pet Detective</h1><p>Scegli una sorgente: la stessa analisi locale produce stati ed eventi in tempo reale.</p>
<form id="form"><div class="modes"><button type="button" data-mode="camera" class="active">Camera live</button><button type="button" data-mode="file">Carica video</button><button type="button" data-mode="youtube">Link YouTube</button></div>
<div id="camera" class="panel active"><p>Usa la camera <strong>0</strong> del computer che esegue il dashboard.</p></div>
<div id="file" class="panel"><label id="drop">Trascina un video qui<br><small>MP4, MOV, M4V, AVI o MKV</small><input id="video" name="video" type="file" accept="video/*" hidden></label></div>
<div id="youtube" class="panel"><label>URL di un singolo video o live YouTube<br><input id="youtube-url" class="url" type="url" placeholder="https://www.youtube.com/watch?v=..."></label></div>
<p><label><input id="qvac" type="checkbox"> Descrizioni Vision sugli eventi rilevanti</label> &nbsp; <label>Controllo di sicurezza ogni <input id="seconds" type="number" min="1" max="3600" value="15" style="width:55px"> s</label></p><button id="start">Avvia analisi</button></form>
<section id="live" class="live hidden"><div><video id="preview" controls muted playsinline></video><iframe id="youtube-preview" class="hidden" allow="autoplay; encrypted-media" allowfullscreen></iframe><p id="status"></p><div class="bar"><i id="bar"></i></div><small id="time"></small></div><div class="card"><strong>Stato attuale</strong><div id="states">In attesa del primo frame…</div><strong>Eventi rilevati</strong><div id="events">—</div></div></section><pre id="report"></pre></main>
<script>const $=x=>document.querySelector(x),f=$('#form'),v=$('#video'),d=$('#drop'),s=$('#status'),r=$('#report'),p=$('#preview'),y=$('#youtube-preview'),live=$('#live');let mode='camera',cameraStream;function options(){return {use_qvac:$('#qvac').checked,semantic_every:Number($('#seconds').value)}}function setMode(next){mode=next;document.querySelectorAll('.modes button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===mode));$('#start').textContent=mode==='file'?'Carica e avvia':'Avvia analisi'}document.querySelectorAll('.modes button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));function select(file){if(!file)return;p.src=URL.createObjectURL(file);s.textContent=file.name}d.onclick=()=>v.click();for(const e of ['dragenter','dragover'])d.addEventListener(e,x=>{x.preventDefault();d.classList.add('over')});for(const e of ['dragleave','drop'])d.addEventListener(e,x=>{x.preventDefault();d.classList.remove('over')});d.addEventListener('drop',e=>{v.files=e.dataTransfer.files;select(v.files[0])});v.onchange=()=>select(v.files[0]);async function showCamera(){if(cameraStream)return;cameraStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});p.srcObject=cameraStream;p.play();}function showPlayer(embed){p.classList.toggle('hidden',!!embed);y.classList.toggle('hidden',!embed);if(embed)y.src=embed;else y.src=''}async function start(){const o=options();r.textContent='';s.textContent='Avvio…';let a,j;if(mode==='file'){if(!v.files[0])throw new Error('Scegli prima un video.');const q=new URLSearchParams(o),body=new FormData();body.append('video',v.files[0]);a=await fetch('/api/videos?'+q,{method:'POST',body});j=await a.json();showPlayer()}else if(mode==='youtube'){const url=$('#youtube-url').value.trim();if(!url)throw new Error('Incolla prima un URL YouTube.');a=await fetch('/api/youtube',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...o,url})});j=await a.json();showPlayer(j.embed_url)}else{await showCamera();a=await fetch('/api/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)});j=await a.json();showPlayer()}if(!a.ok)throw new Error(j.detail||'Errore di avvio');live.classList.remove('hidden');poll(j.session_id)}f.onsubmit=async e=>{e.preventDefault();try{await start()}catch(err){s.textContent=err.message}};function seek(t){if(mode==='file'){p.currentTime=t;p.play().catch(()=>{})}}function render(j){$('#bar').style.width=(j.progress||0)+'%';$('#time').textContent=j.processed_seconds!==undefined?`${j.processed_seconds}s elaborati${j.duration_seconds?` / ${Math.round(j.duration_seconds)}s`:''}`:'';if(mode==='file'&&j.status==='processing'&&Number.isFinite(j.processed_seconds)&&Math.abs(p.currentTime-j.processed_seconds)>1)p.currentTime=j.processed_seconds;$('#states').textContent=Object.entries(j.states||{}).map(([dog,state])=>`${dog}: ${state}`).join(' · ')||'Ricerca dei cani…';const list=$('#events');list.textContent='';const events=(j.events||[]).slice().reverse();if(!events.length){list.textContent='Nessun cambio di attività finora.';return}events.forEach(e=>{const b=document.createElement('button');b.className='event';b.textContent=`${e.video_seconds}s · ${e.dog_id||'Entrambi'} — ${e.kind}${e.description?`: ${e.description}`:''}`;b.onclick=()=>seek(e.video_seconds);list.append(b)})}async function poll(id){const a=await fetch('/api/jobs/'+id),j=await a.json();s.textContent='Sessione '+id+': '+j.status;render(j);if(j.status==='complete'){r.textContent=JSON.stringify(j.report,null,2);return}if(j.status==='failed'){r.textContent=j.error;return}setTimeout(()=>poll(id),1000)}</script>'''
