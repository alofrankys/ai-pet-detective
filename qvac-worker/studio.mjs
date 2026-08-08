import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const publicDir = path.join(here, 'public')
const mediaPipeDir = path.join(here, 'node_modules/@mediapipe/tasks-vision')
const faceLandmarkerModel = path.join(root, 'models/face_landmarker.task')
const port = Number(process.env.PORT || 8790)
const detectorPort = Number(process.env.DETECTOR_PORT || 8795)
const detectorModel = path.resolve(process.env.DETECTOR_MODEL || path.join(root, 'models/yolov10m.onnx'))
const poseModel = path.resolve(process.env.POSE_MODEL || path.join(root, 'models/rtmpose-ap10k.onnx'))
const visionpsyEndpoint = process.env.VISIONPSY_ENDPOINT || ''
const visionpsyDebug = process.env.DEBUG_VISIONPSY === '1'
const bareBin = path.join(here, 'node_modules/bare-runtime/bin/bare')
let detector = null
let detectorReady = false
let detectorReason = 'starting'
let poseReady = false

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream' }
const mediaPipeAssets = new Map([
  ['/mediapipe/vision_bundle.mjs',path.join(mediaPipeDir,'vision_bundle.mjs')],
  ...['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm','vision_wasm_module_internal.js','vision_wasm_module_internal.wasm'].map(file=>[`/mediapipe/wasm/${file}`,path.join(mediaPipeDir,'wasm',file)]),
  ['/models/face_landmarker.task',faceLandmarkerModel]
])

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readBody(req, limit = 4_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) reject(new Error('frame too large'))
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function detectorHealth() {
  try {
    const response = await fetch(`http://127.0.0.1:${detectorPort}/health`, { signal: AbortSignal.timeout(1500) })
    detectorReady = response.ok
    if(response.ok){const health=await response.json();poseReady=Boolean(health.pose)}else poseReady=false
    detectorReason = response.ok ? null : `health ${response.status}`
  } catch (error) {
    detectorReady = false
    poseReady = false
    detectorReason = String(error?.cause?.code || error?.message || error)
  }
  return detectorReady
}

function startDetector() {
  if (!fs.existsSync(detectorModel)) {
    detectorReason = `model missing: ${detectorModel}`
    return
  }
  detector = spawn(process.execPath, [bareBin, 'detector.mjs', String(detectorPort), detectorModel, fs.existsSync(poseModel)?poseModel:''], {
    cwd: here,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  detector.stdout.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.log(text)
    if (text.includes('ready on')) detectorReady = true
  })
  detector.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.error(text)
  })
  detector.on('exit', (code) => {
    detectorReady = false
    detectorReason = `worker exited (${code ?? 'unknown'})`
  })
}

function extractJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { return null }
}

async function interpretFrame(jpeg, facts = [], language = 'en', frameCount = 1) {
  if (!visionpsyEndpoint) return null
  const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`
  const labels = facts.map((item) => item.label).filter(Boolean).slice(0, 5)
  const italian = language === 'it'
  const hasPerson = labels.includes('person')
  const hasDog = labels.includes('dog')
  const hasAnimal = labels.some((label) => ['bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe'].includes(label))
  const names = facts.map((item) => item.name).filter(Boolean).slice(0, 5)
  const movements = facts.filter((item) => item.motionText).map((item) => `${item.name || item.label}: ${item.motionText}`).slice(0, 3)
  const faceSignals = facts.flatMap((item) => Array.isArray(item.faceCues) ? item.faceCues.map(cue=>`${item.name || item.label}: ${cue.text}`) : []).slice(0, 2)
  const poseSignals = facts.flatMap((item) => Array.isArray(item.poseCues) ? item.poseCues.map(cue=>`${item.name || item.label}: ${cue.text}`) : []).slice(0, 3)
  const sequenceGrounding = frameCount > 1 ? italian ? `L'immagine è una sequenza cronologica di ${frameCount} fotogrammi, numerati dall'inizio alla fine. Descrivi il cambiamento osservabile tra essi.` : `The image is a chronological sequence of ${frameCount} frames, numbered from earliest to latest. Describe the observable change across them.` : ''
  const motionGrounding = movements.length ? italian ? `Movimento recente misurato: ${movements.join('; ')}. Uniscilo naturalmente alla posa o espressione visibile.` : `Measured recent movement: ${movements.join('; ')}. Combine it naturally with the visible pose or expression.` : ''
  const faceGrounding = faceSignals.length ? italian ? `Segnali facciali locali misurati: ${faceSignals.join('; ')}. Descrivili come gesti visibili, non come emozioni certe.` : `Measured local facial cues: ${faceSignals.join('; ')}. Describe them as visible gestures, not certain emotions.` : ''
  const poseGrounding = poseSignals.length ? italian ? `Keypoint animali QVAC misurati: ${poseSignals.join('; ')}. Usali soltanto come postura osservabile.` : `Measured QVAC animal keypoints: ${poseSignals.join('; ')}. Use them only as observable posture.` : ''
  const grounding = labels.length ? `QVAC detector candidates: ${labels.join(', ')}. Tracked names: ${names.join(', ') || 'none'}. Candidates are not ground truth: if a dog is not unmistakably visible, ignore the dog candidate. ${motionGrounding} ${faceGrounding} ${poseGrounding} You may additionally name one unmistakable object being held or worn.` : 'Name only one unmistakable visible subject or object.'
  const focus = italian
    ? hasDog ? `FOCUS CANE: scegli soltanto l'azione canina più chiara, senza forzarne una. Descrivi cosa fa ciascun cane e il luogo solo se utile all'azione: pavimento, divano, letto, sedia, erba, giardino o vicino a una pianta. Considera seduto, sdraiato, in piedi, cammina, corre, annusa, si strofina, si rotola, si scuote, si allunga, sale o scende, riposa e dorme. Osserva direzione, velocità, testa, occhi, orecchie, coda e bocca. Se sono inequivocabili, segnala interazioni con palla, corda o gioco da tiro, anello, frisbee, peluche, osso, bastone, Kong o gioco puzzle, gioco da masticare o sonoro, ciotola, cibo, snack o premietto. Se una persona partecipa, includi gesto o espressione rilevante. Scrivi "scodinzola" solo se il movimento della coda è visibile. Usa "dorme" solo se è sdraiato immobile con occhi chiusi; usa "linguaggio corporeo compatibile con rilassamento, gioco, eccitazione o cautela" invece di emozioni certe. Ignora piante, mobili e sfondo se non spiegano ciò che il cane sta facendo.` : hasPerson && hasAnimal ? 'Descrivi il gesto o la distanza tra persona e animale.' : hasPerson ? 'Descrivi soltanto gesto, sguardo, bocca, guance, occhi, sopracciglia o smorfia della persona.' : hasAnimal ? 'Descrivi soltanto postura, testa, orecchie, coda, bocca, direzione o interazione dell’animale.' : 'Descrivi soltanto un oggetto centrale, tenuto, usato o mosso; ignora lo sfondo.'
    : hasDog ? `DOG FOCUS: choose only the clearest dog action; never force one. Describe what each dog is doing and mention location only when it explains the action: floor, couch, bed, chair, grass, garden, or near a plant. Consider sitting, lying, standing, walking, running, sniffing, rubbing, rolling, shaking, stretching, climbing, descending, resting, and sleeping. Observe direction, speed, head, eyes, ears, tail, and mouth. When unmistakable, report interactions with a ball, rope or tug toy, ring, frisbee, plush toy, bone, stick, Kong or puzzle toy, chew or squeaky toy, bowl, food, snack, or treat. When a person participates, include a relevant gesture or expression. Say "tail wagging" only when tail motion is visible. Say "sleeping" only when lying still with closed eyes; say "body language consistent with relaxed, playful, excited, or cautious" instead of certain emotions. Ignore plants, furniture, and background unless they explain the dog's action.` : hasPerson && hasAnimal ? 'Describe the gesture or distance between the person and animal.' : hasPerson ? 'Describe only the person’s gesture, gaze, mouth, cheeks, eyes, eyebrows, or grimace.' : hasAnimal ? 'Describe only the animal’s posture, head, ears, tail, mouth, direction, or interaction.' : 'Describe only a central, held, used, or moving object; ignore background objects.'
  const prompt = italian
    ? `Rispondi soltanto con una concreta osservazione della videocamera in italiano. ${sequenceGrounding} ${grounding} ${focus} Se più soggetti rilevati partecipano chiaramente, menzionali senza inventare relazioni. Unisci il movimento misurato con gesto, postura o espressione visibile. Per persone e animali puoi dire "espressione" o "linguaggio corporeo compatibile con", senza affermare un'emozione certa. Scrivi una frase naturale completa con un verbo. Non elencare dettagli assenti e non citare istruzioni, lingua, detector o modello. Massimo 22 parole. Se manca un dettaglio affidabile, rispondi SAME.`
    : `Return only one concrete camera observation in English. ${sequenceGrounding} ${grounding} ${focus} If several detected subjects clearly participate, mention them without inventing relationships. Combine measured movement with the visible gesture, posture, or expression. For people and animals you may say "expression" or "body language consistent with", without claiming a certain emotion. Write a complete natural sentence with a verb. Never list absent details or mention instructions, language, detector, or model. At most 22 words. If no reliable detail is visible, reply SAME.`
  const response = await fetch(visionpsyEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'visionpsy', max_tokens: 110, temperature: 0.1,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: prompt }
      ] }]
    }),
    signal: AbortSignal.timeout(45_000)
  })
  if (!response.ok) throw new Error(`VisionPsy ${response.status}`)
  const payload = await response.json()
  let content = String(payload?.choices?.[0]?.message?.content || '').replace(/\s+/g, ' ').trim()
  const structured = extractJson(content)
  if (structured?.summary) content = String(structured.summary).replace(/\s+/g, ' ').trim()
  const firstSentence = content.split(/(?<=[.!?])\s/)[0]
  const leakedPrompt = /^camera\b/i.test(firstSentence) || /\b(qvac detector|dog focus|focus cane|vqa|detector|model|license plate|chronologically stacked|image consists|image is a sequence|replacement|sostituzion|most interesting|visible change|in english|in italian|write one|short sentence|maximum|massimo|scrivi|descrivi|simple live camera|reply same|internal feelings|name only|wearable accessories|camera observation task)\b/i.test(firstSentence)
  const unhelpful = /\b(cannot|can't|unable|does not clearly|no clear|no visible|no .{0,30} clearly|not clearly visible|not visible|non posso|non è chiar|non sono chiar|nessun dettaglio|impossibile)\b/i.test(firstSentence)
  if(visionpsyDebug)console.log('[VisionPsy raw]',JSON.stringify({frameCount,content,firstSentence,leakedPrompt,unhelpful}))
  if (!firstSentence || /^same[.!]?$/i.test(firstSentence) || leakedPrompt || unhelpful || firstSentence.length > 240) return null
  let observable = firstSentence
    .split(/\b(?:indicating|suggesting|feeling)\b/i)[0]
    .replace(/\ba object\b/gi, 'an object')
    .replace(/[,;:\s]+$/, '')
    .trim()
  if (observable.split(/\s+/).length > 20) {
    const completeClause = observable.split(/[,;]/)[0].replace(/[.!?\s]+$/, '').trim()
    if (completeClause.split(/\s+/).length >= 5) observable = `${completeClause}.`
    else return null
  }
  if (observable.split(/\s+/).length < 3) return null
  const hasNaturalVerb = /\b(is|has|looks|appears|seems|raises|opens|smiles|turns|holds|gazes|shows|keeps|leans|faces|moves|wears|sits|stands|walks|runs|sniffs|chews|eats|plays|approaches|leaves|gestures|points|reaches|touches|bends|lies|rests|sleeps|rubs|rolls|shakes|stretches|climbs|descends|wags|exhibits|shifts|è|ha|sembra|appare|guarda|alza|apre|sorride|gira|tiene|mostra|inclina|muove|indossa|siede|sta|cammina|corre|annusa|mastica|mangia|gioca|avvicina|lascia|gesticola|indica|raggiunge|tocca|piega|giace|riposa|dorme|strofina|rotola|scuote|allunga|sale|scende|scodinzola|cambia)\b/i.test(observable)
  if (!hasNaturalVerb) return null
  const detectorSupport=facts.length?Math.max(...facts.map(item=>Number(item.score)||0)):0,confidence=Math.min(.9,.42+detectorSupport*.35+(frameCount>1?.04:0)+(movements.length?.035:0)+(faceSignals.length?.035:0)+(poseSignals.length?.04:0))
  let kind = labels.includes('person') && labels.some((label) => label === 'dog' || label === 'cat')
    ? 'interaction' : labels.includes('person') ? 'human' : labels.some((label) => label === 'dog' || label === 'cat') ? 'dog' : 'object'
  let summary = kind === 'dog' ? observable.replace(/\bsmiles?\b/gi, 'open mouths') : observable
  const dogSeenInSummary = /\b(dog|dogs|puppy|cane|cani|cucciolo|cuccioli)\b/i.test(summary)
  let motionFused = movements.length > 0 && /\b(move|walk|run|dance|jump|step|spost|cammin|corr|ball|salt)\w*/i.test(summary)
  if (movements.length && !motionFused) {
    const movement = facts.find((item) => item.motionText&&(!hasDog||dogSeenInSummary||item.label!=='dog'))
    if(movement){const rawName=String(movement.name || movement.label || '').trim(),subject=italian ? rawName === 'persona' ? 'la persona' : rawName : rawName === 'person' ? 'the person' : rawName;summary=`${summary.replace(/[.!?]+$/,'')}${italian?', mentre ':' while '}${subject} ${movement.motionText}.`;motionFused=true}
  }
  const dogVerified = !hasDog || dogSeenInSummary
  if(hasDog&&!dogVerified)kind=labels.includes('person')?'human':'object'
  return { summary, confidence, kind, motionFused, dogVerified, evidence:{frames:frameCount,detector:Number(detectorSupport.toFixed(3)),motion:Boolean(movements.length),face:Boolean(faceSignals.length),pose:Boolean(poseSignals.length)} }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      await detectorHealth()
      return json(res, 200, {
        detector: { ready: detectorReady, engine: '@qvac/onnx · Core ML', reason: detectorReason },
        animalPose: { enabled: poseReady, engine: poseReady?'@qvac/onnx · RTMPose AP-10K':'not connected', provider: poseReady?'QVAC auto_gpu (Core ML requested)':null },
        visionpsy: { enabled: Boolean(visionpsyEndpoint), engine: visionpsyEndpoint ? 'VisionPsy local' : 'not connected' },
        facialCues: { enabled: fs.existsSync(faceLandmarkerModel), engine: 'MediaPipe Face Landmarker · local WASM' },
        privacy: 'local'
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/detect') {
      if (!detectorReady && !(await detectorHealth())) return json(res, 503, { error: detectorReason })
      const body = await readBody(req, 1_300_000)
      const response = await fetch(`http://127.0.0.1:${detectorPort}/detect`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
        signal: AbortSignal.timeout(12_000)
      })
      const output = await response.text()
      res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      return res.end(output)
    }
    if (req.method === 'POST' && url.pathname === '/api/pose') {
      if (!poseReady) return json(res,503,{error:'animal pose unavailable'})
      const body=await readBody(req,200_000),response=await fetch(`http://127.0.0.1:${detectorPort}/pose`,{method:'POST',headers:{'content-type':'application/octet-stream'},body,signal:AbortSignal.timeout(12_000)})
      const output=await response.text();res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});return res.end(output)
    }
    if (req.method === 'POST' && url.pathname === '/api/interpret') {
      if (!visionpsyEndpoint) return json(res, 503, { error: 'VisionPsy local endpoint not configured' })
      const jpeg = await readBody(req)
      let facts = []
      try { facts = JSON.parse(String(req.headers['x-vision-facts'] || '[]')) } catch {}
      const language = req.headers['x-language'] === 'it' ? 'it' : 'en'
      const frameCount = Math.max(1,Math.min(4,Number(req.headers['x-frame-count'])||1))
      const observation = await interpretFrame(jpeg, Array.isArray(facts) ? facts : [], language, frameCount)
      return json(res, observation ? 200 : 422, observation || { error: 'No structured observation' })
    }
    if (req.method === 'GET') {
      const asset = mediaPipeAssets.get(url.pathname)
      if(asset){if(!fs.existsSync(asset))return json(res,404,{error:'asset not installed'});res.writeHead(200,{'content-type':types[path.extname(asset)]||'application/octet-stream','cache-control':'public, max-age=3600'});return fs.createReadStream(asset).pipe(res)}
      const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (!['index.html', 'styles.css', 'app.js'].includes(requested)) return json(res, 404, { error: 'not found' })
      const file = path.join(publicDir, requested)
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
      return fs.createReadStream(file).pipe(res)
    }
    return json(res, 404, { error: 'not found' })
  } catch (error) {
    return json(res, 500, { error: String(error?.message || error) })
  }
})

startDetector()
server.listen(port, '127.0.0.1', () => console.log(`VisionPsy Studio ready at http://127.0.0.1:${port}`))

function close() {
  detector?.kill('SIGTERM')
  server.close(() => process.exit(0))
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
