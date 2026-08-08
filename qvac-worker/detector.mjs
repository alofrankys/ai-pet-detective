// Standalone local detector adapted from VisionPsy TwinPaws. It intentionally
// returns every dog detection; collapsing by class would lose the two subjects.
import onnx from '@qvac/onnx'
import http from 'bare-http1'
import { Buffer } from 'bare-buffer'

const PORT = Number(Bare.argv?.[2] || 8795)
const MODEL = Bare.argv?.[3] || '../models/yolov10m.onnx'
const POSE_MODEL = Bare.argv?.[4] || ''
const SIZE = 640
const PIXELS = SIZE * SIZE
const POSE_SIZE = 256
const POSE_PIXELS = POSE_SIZE * POSE_SIZE
const LABELS = ['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush']

onnx.configureEnvironment({ loggingLevel: 'error' })
const session = onnx.createSession(MODEL, { provider: 'auto_gpu' })
const inputName = onnx.getInputInfo(session)[0].name
const tensor = new Float32Array(3 * PIXELS)
let poseSession = null
let poseInputName = null
const poseTensor = new Float32Array(3 * POSE_PIXELS)
if(POSE_MODEL){
  try{poseSession=onnx.createSession(POSE_MODEL,{provider:'auto_gpu'});poseInputName=onnx.getInputInfo(poseSession)[0].name;console.log(`[AI Pet Detective] QVAC animal pose ready: ${POSE_MODEL}`)}
  catch(error){console.error(`[AI Pet Detective] animal pose unavailable: ${String(error?.message||error)}`)}
}
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

function inferPose(rgb){
  const mean=[123.675,116.28,103.53],std=[58.395,57.12,57.375]
  for(let index=0;index<POSE_PIXELS;index++)for(let channel=0;channel<3;channel++)poseTensor[channel*POSE_PIXELS+index]=(rgb[index*3+channel]-mean[channel])/std[channel]
  const result=onnx.run(poseSession,[{name:poseInputName,shape:[1,3,POSE_SIZE,POSE_SIZE],type:'float32',data:poseTensor}])
  const xOutput=result.find(item=>item.name==='simcc_x')||result[0],yOutput=result.find(item=>item.name==='simcc_y')||result[1],keypoints=[]
  for(let keypoint=0;keypoint<17;keypoint++){
    let bestX=0,bestY=0,maxX=-Infinity,maxY=-Infinity
    for(let index=0;index<512;index++){
      const x=xOutput.data[keypoint*512+index],y=yOutput.data[keypoint*512+index]
      if(x>maxX){maxX=x;bestX=index}if(y>maxY){maxY=y;bestY=index}
    }
    keypoints.push({x:bestX/512,y:bestY/512,score:Math.max(0,Math.min(1,(maxX+maxY)/2))})
  }
  return keypoints
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, engine: '@qvac/onnx', model: MODEL, pose: Boolean(poseSession), poseModel: poseSession?POSE_MODEL:null }))
  }
  if (req.method !== 'POST' || !['/detect','/pose'].includes(req.url)) return res.writeHead(404).end('not found')
  if (busy) return res.writeHead(429).end('{"error":"busy"}')
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const rgb = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
    const poseRequest=req.url==='/pose'
    if(poseRequest&&!poseSession)return res.writeHead(503).end('{"error":"animal pose unavailable"}')
    if (rgb.length !== 3 * (poseRequest?POSE_PIXELS:PIXELS)) return res.writeHead(400).end(`{"error":"expected ${poseRequest?'256x256':'640x640'} RGB"}`)
    busy = true
    try {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(poseRequest?{ok:true,keypoints:inferPose(rgb)}:{ok:true,objects:infer(rgb)}))
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error) }))
    } finally { busy = false }
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`[AI Pet Detective] QVAC detector ready on :${PORT}`))
