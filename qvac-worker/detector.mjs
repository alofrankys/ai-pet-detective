// Standalone local detector adapted from VisionPsy TwinPaws. It intentionally
// returns every dog detection; collapsing by class would lose the two subjects.
import onnx from '@qvac/onnx'
import http from 'bare-http1'
import { Buffer } from 'bare-buffer'

const PORT = Number(Bare.argv?.[2] || 8795)
const MODEL = Bare.argv?.[3] || '../models/yolov10m.onnx'
const SIZE = 640
const PIXELS = SIZE * SIZE
const LABELS = ['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush']

onnx.configureEnvironment({ loggingLevel: 'error' })
const session = onnx.createSession(MODEL, { provider: 'auto_gpu' })
const inputName = onnx.getInputInfo(session)[0].name
const tensor = new Float32Array(3 * PIXELS)
let busy = false

function infer(rgb) {
  for (let i = 0; i < PIXELS; i++) {
    tensor[i] = rgb[i * 3] / 255
    tensor[PIXELS + i] = rgb[i * 3 + 1] / 255
    tensor[2 * PIXELS + i] = rgb[i * 3 + 2] / 255
  }
  const output = onnx.run(session, [{ name: inputName, shape: [1, 3, SIZE, SIZE], type: 'float32', data: tensor }])[0].data
  const objects = []
  for (let i = 0; i < 300; i++) {
    const offset = i * 6
    const score = output[offset + 4]
    if (score < 0.45) continue
    const classId = output[offset + 5] | 0
    objects.push({
      label: LABELS[classId] || 'object', score: +score.toFixed(3),
      box: [output[offset] / SIZE, output[offset + 1] / SIZE, output[offset + 2] / SIZE, output[offset + 3] / SIZE]
    })
  }
  return objects
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, engine: '@qvac/onnx', model: MODEL }))
  }
  if (req.method !== 'POST' || req.url !== '/detect') return res.writeHead(404).end('not found')
  if (busy) return res.writeHead(429).end('{"error":"busy"}')
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const rgb = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
    if (rgb.length !== 3 * PIXELS) return res.writeHead(400).end('{"error":"expected 640x640 RGB"}')
    busy = true
    try {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, objects: infer(rgb) }))
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error) }))
    } finally { busy = false }
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[AI Pet Detective] QVAC detector ready on :${PORT}`))
