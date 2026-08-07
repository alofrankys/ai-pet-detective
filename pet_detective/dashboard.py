from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from .storage import EventStore

app = FastAPI(title="AI Pet Detective")

@app.get("/api/sessions/{session_id}")
def session(session_id: str): return EventStore().report(session_id)

@app.get("/", response_class=HTMLResponse)
def home():
    return '''<main><h1>AI Pet Detective</h1><p>Local activity reports for two dogs.</p><input id="s" value="demo-session"><button onclick="go()">Load report</button><pre id="o"></pre><script>async function go(){o.textContent=JSON.stringify(await fetch('/api/sessions/'+s.value).then(x=>x.json()),null,2)}</script></main>'''
