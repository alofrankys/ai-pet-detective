from __future__ import annotations

import base64, json, os
from pathlib import Path
from urllib.request import Request, urlopen


class QvacVision:
    """Optional bridge to a local QVAC OpenAI-compatible vision endpoint."""
    def __init__(self, endpoint: str | None = None, model: str | None = None):
        self.endpoint = endpoint or os.getenv("QVAC_ENDPOINT")
        self.model = model or os.getenv("QVAC_MODEL")

    @property
    def enabled(self) -> bool: return bool(self.endpoint and self.model)

    def analyse(self, image_path: str) -> dict | None:
        if not self.enabled: return None
        encoded = base64.b64encode(Path(image_path).read_bytes()).decode()
        prompt = "Return only JSON with activity, description, confidence (0..1). Describe the dogs' observable activity; do not infer health or breed."
        body = {"model": self.model, "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}}]}]}
        request = Request(self.endpoint, data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
        with urlopen(request, timeout=30) as response:
            content = json.load(response)["choices"][0]["message"]["content"]
        try: return json.loads(content)
        except json.JSONDecodeError: return {"activity": "unstructured", "description": content, "confidence": None}
