import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const publicDir = path.join(here, 'public')
const mediaPipeDir = path.join(here, 'node_modules/@mediapipe/tasks-vision')
const faceLandmarkerModel = path.join(root, 'models/face_landmarker.task')
const handLandmarkerModel = path.join(root, 'models/hand_landmarker.task')
const port = Number(process.env.PORT || 8790)
const detectorPort = Number(process.env.DETECTOR_PORT || 8795)
const detectorModel = path.resolve(process.env.DETECTOR_MODEL || path.join(root, 'models/yolov10m.onnx'))
const poseModel = path.resolve(process.env.POSE_MODEL || path.join(root, 'models/rtmpose-ap10k.onnx'))
let visionpsyEndpoint = process.env.VISIONPSY_ENDPOINT || 'http://127.0.0.1:8788/v1/chat/completions'
const visionpsyDebug = process.env.DEBUG_VISIONPSY === '1'
const bareBin = path.join(here, 'node_modules/bare-runtime/bin/bare')
const ytDlpBin = path.join(root, '.venv/bin/yt-dlp')
const youtubeStreams = new Map()
let detector = null
let detectorReady = false
let detectorReason = 'starting'
let poseReady = false
let visionpsyReady = false
let visionpsyStartPromise = null

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.task': 'application/octet-stream' }
const mediaPipeAssets = new Map([
  ['/mediapipe/vision_bundle.mjs',path.join(mediaPipeDir,'vision_bundle.mjs')],
  ...['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm','vision_wasm_module_internal.js','vision_wasm_module_internal.wasm'].map(file=>[`/mediapipe/wasm/${file}`,path.join(mediaPipeDir,'wasm',file)]),
  ['/models/face_landmarker.task',faceLandmarkerModel],
  ['/models/hand_landmarker.task',handLandmarkerModel]
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

function isYoutubeUrl(value){
  try{
    const parsed=new URL(String(value||'').trim())
    const host=parsed.hostname.toLowerCase().replace(/^www\.|^m\./,'')
    return parsed.protocol==='https:'&&(host==='youtube.com'||host==='youtu.be')
  }catch{return false}
}

function runProcess(command,args,timeoutMs=45_000){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe']})
    const stdout=[],stderr=[];let size=0,settled=false
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);error?reject(error):resolve(value)}
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size<3_000_000)stdout.push(chunk)})
    child.stderr.on('data',chunk=>{if(stderr.reduce((sum,item)=>sum+item.length,0)<20_000)stderr.push(chunk)})
    child.on('error',error=>finish(error))
    child.on('exit',code=>code===0?finish(null,Buffer.concat(stdout).toString('utf8')):finish(new Error(Buffer.concat(stderr).toString('utf8').trim()||`yt-dlp exited with ${code}`)))
    const timeout=setTimeout(()=>{child.kill('SIGTERM');finish(new Error('YouTube resolution timed out'))},timeoutMs)
  })
}

async function resolveYoutubeVideo(value){
  if(!isYoutubeUrl(value))throw new Error('Enter a valid YouTube video URL')
  if(!fs.existsSync(ytDlpBin))throw new Error("YouTube support is not installed")
  const output=await runProcess(ytDlpBin,['--no-playlist','--no-warnings','--quiet','--format','best[ext=mp4][height<=720]/best[height<=720][vcodec^=avc]/best[height<=720]/best','--dump-single-json',value])
  const info=JSON.parse(output)
  if(info.is_live)throw new Error('YouTube live streams are not supported yet; use Live camera for live analysis')
  if(!/^https?:\/\//.test(String(info.url||'')))throw new Error('No playable stream was found for this video')
  const token=randomUUID(),httpHeaders=info.http_headers&&typeof info.http_headers==='object'?info.http_headers:{}
  youtubeStreams.set(token,{url:info.url,title:String(info.title||'YouTube video').slice(0,180),duration:Number(info.duration)||null,httpHeaders,createdAt:Date.now()})
  for(const [key,item] of youtubeStreams){if(Date.now()-item.createdAt>4*60*60*1000||youtubeStreams.size>12)youtubeStreams.delete(key)}
  return {token,title:youtubeStreams.get(token).title,duration:youtubeStreams.get(token).duration}
}

async function proxyYoutubeVideo(req,res,entry){
  const controller=new AbortController();req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort()})
  const headers={}
  for(const key of ['user-agent','referer','origin'])if(entry.httpHeaders[key]||entry.httpHeaders[key.replace(/(^|-)(\w)/g,(_,dash,char)=>dash+char.toUpperCase())])headers[key]=entry.httpHeaders[key]||entry.httpHeaders[key.replace(/(^|-)(\w)/g,(_,dash,char)=>dash+char.toUpperCase())]
  if(req.headers.range)headers.range=req.headers.range
  const upstream=await fetch(entry.url,{headers,redirect:'follow',signal:controller.signal})
  if(!upstream.ok&&upstream.status!==206)return json(res,upstream.status,{error:'YouTube media stream unavailable'})
  const responseHeaders={'content-type':upstream.headers.get('content-type')||'video/mp4','accept-ranges':upstream.headers.get('accept-ranges')||'bytes','cache-control':'private, no-store'}
  for(const key of ['content-length','content-range']){const value=upstream.headers.get(key);if(value)responseHeaders[key]=value}
  res.writeHead(upstream.status,responseHeaders)
  if(req.method==='HEAD'||!upstream.body)return res.end()
  const reader=upstream.body.getReader()
  try{while(true){const {done,value}=await reader.read();if(done)break;if(!res.write(Buffer.from(value)))await new Promise(resolve=>res.once('drain',resolve))}res.end()}
  catch(error){if(!res.destroyed)res.destroy(error)}
}

function visionpsyBaseUrl(){
  try{return new URL(visionpsyEndpoint).origin}catch{return 'http://127.0.0.1:8788'}
}

async function visionpsyHealth(){
  try{const response=await fetch(`${visionpsyBaseUrl()}/health`,{signal:AbortSignal.timeout(1500)});visionpsyReady=response.ok}
  catch{visionpsyReady=false}
  return visionpsyReady
}

async function ensureVisionPsy(){
  if(await visionpsyHealth())return true
  if(visionpsyStartPromise)return visionpsyStartPromise
  visionpsyStartPromise=(async()=>{
    const loader=path.resolve(root,'../visionpsy-twinpaws/shared/load-vlm.mjs')
    if(!fs.existsSync(loader))return false
    try{
      const {loadTwinPawsVlm}=await import(loader)
      const runtime=await loadTwinPawsVlm()
      visionpsyEndpoint=`${runtime.baseUrl}/v1/chat/completions`
      return await visionpsyHealth()
    }catch(error){if(visionpsyDebug)console.error('[VisionPsy startup]',error);return false}
  })().finally(()=>{visionpsyStartPromise=null})
  return visionpsyStartPromise
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

async function interpretFrameLegacy(jpeg, facts = [], language = 'en', frameCount = 1) {
  if (!visionpsyEndpoint) return null
  const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`
  const labels = facts.map((item) => item.label).filter(Boolean).slice(0, 5)
  const italian = language === 'it'
  const hasPerson = labels.includes('person')
  const hasDog = labels.includes('dog')
  const hasAnimal = labels.some((label) => ['bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe'].includes(label))
  const hasObject = labels.some((label) => label !== 'person' && !['bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe'].includes(label))
  const visibleDogs = labels.filter(label=>label==='dog').length
  const names = facts.map((item) => item.name).filter(Boolean).slice(0, 5)
  const movements = facts.filter((item) => item.motionText).map((item) => `${item.name || item.label}: ${item.motionText}`).slice(0, 3)
  const faceSignals = facts.flatMap((item) => Array.isArray(item.faceCues) ? item.faceCues.map(cue=>`${item.name || item.label}: ${cue.text}`) : []).slice(0, 2)
  const poseSignals = facts.flatMap((item) => Array.isArray(item.poseCues) ? item.poseCues.map(cue=>`${item.name || item.label}: ${cue.text}`) : []).slice(0, 3)
  const sequenceGrounding = frameCount > 1 ? italian ? `L'immagine è una sequenza cronologica di ${frameCount} fotogrammi, numerati dall'inizio alla fine. Descrivi il cambiamento osservabile tra essi.` : `The image is a chronological sequence of ${frameCount} frames, numbered from earliest to latest. Describe the observable change across them.` : ''
  const motionGrounding = movements.length ? italian ? `Movimento recente misurato: ${movements.join('; ')}. Uniscilo naturalmente alla posa o espressione visibile.` : `Measured recent movement: ${movements.join('; ')}. Combine it naturally with the visible pose or expression.` : ''
  const faceGrounding = faceSignals.length ? italian ? `Segnali facciali locali misurati: ${faceSignals.join('; ')}. Descrivili come gesti visibili, non come emozioni certe.` : `Measured local facial cues: ${faceSignals.join('; ')}. Describe them as visible gestures, not certain emotions.` : ''
  const poseGrounding = poseSignals.length ? italian ? `Keypoint animali QVAC misurati: ${poseSignals.join('; ')}. Usali soltanto come postura osservabile.` : `Measured QVAC animal keypoints: ${poseSignals.join('; ')}. Use them only as observable posture.` : ''
  const dogPairGrounding=visibleDogs>=2?'Two distinct dogs are tracked. Never describe either dog as a toy or object; describe their dog-to-dog interaction only when visible.':''
  const objectGrounding=hasObject?'Name only a tracked, unmistakable object.':'No object is tracked: do not invent a toy, ball, food, furniture, or held object.'
  const grounding = labels.length ? `QVAC detector candidates: ${labels.join(', ')}. Tracked names: ${names.join(', ') || 'none'}. Candidates are not ground truth: if a dog is not unmistakably visible, ignore the dog candidate. ${dogPairGrounding} ${objectGrounding} ${motionGrounding} ${faceGrounding} ${poseGrounding}` : 'Name only one unmistakable visible subject or object.'
  const focus = italian
    ? hasDog ? `FOCUS CANE: scegli soltanto l'azione canina più chiara, senza forzarne una. Descrivi cosa fa ciascun cane e il luogo solo se utile all'azione: pavimento, divano, letto, sedia, erba, giardino o vicino a una pianta. Nomina erba o giardino soltanto se visibili con chiarezza. Considera seduto, sdraiato, in piedi, cammina, corre, annusa, si strofina, si rotola, si scuote, si allunga, sale o scende, riposa e dorme. Osserva direzione, velocità, testa, occhi, orecchie, coda e bocca. Se sono inequivocabili, segnala interazioni con palla, corda o gioco da tiro, anello, frisbee, peluche, osso, bastone, Kong o gioco puzzle, gioco da masticare o sonoro, ciotola, cibo, snack o premietto. Se una persona partecipa, includi gesto o espressione rilevante. Scrivi "scodinzola" solo se il movimento della coda è visibile. Usa "dorme" solo se è sdraiato immobile con occhi chiusi; usa "linguaggio corporeo compatibile con rilassamento, gioco, eccitazione o cautela" invece di emozioni certe. Ignora piante, mobili e sfondo se non spiegano ciò che il cane sta facendo.` : hasPerson && hasAnimal ? 'Descrivi il gesto o la distanza tra persona e animale.' : hasPerson ? 'Descrivi soltanto gesto, sguardo, bocca, guance, occhi, sopracciglia o smorfia della persona.' : hasAnimal ? 'Descrivi soltanto postura, testa, orecchie, coda, bocca, direzione o interazione dell’animale.' : 'Descrivi soltanto un oggetto centrale, tenuto, usato o mosso; ignora lo sfondo.'
    : hasDog ? `DOG FOCUS: choose only the clearest dog action; never force one. Describe what each dog is doing and mention location only when it explains the action: floor, couch, bed, chair, grass, garden, or near a plant. Name grass or a garden only if clearly visible. Consider sitting, lying, standing, walking, running, sniffing, rubbing, rolling, shaking, stretching, climbing, descending, resting, and sleeping. Observe direction, speed, head, eyes, ears, tail, and mouth. When unmistakable, report interactions with a ball, rope or tug toy, ring, frisbee, plush toy, bone, stick, Kong or puzzle toy, chew or squeaky toy, bowl, food, snack, or treat. When a person participates, include a relevant gesture or expression. Say "tail wagging" only when tail motion is visible. Say "sleeping" only when lying still with closed eyes; say "body language consistent with relaxed, playful, excited, or cautious" instead of certain emotions. Ignore plants, furniture, and background unless they explain the dog's action.` : hasPerson && hasAnimal ? 'Describe the gesture or distance between the person and animal.' : hasPerson ? 'Describe only the person’s gesture, gaze, mouth, cheeks, eyes, eyebrows, or grimace.' : hasAnimal ? 'Describe only the animal’s posture, head, ears, tail, mouth, direction, or interaction.' : 'Describe only a central, held, used, or moving object; ignore background objects.'
  const generalVocabulary=italian
    ? `Cerca l'azione più informativa tra postura e movimento; gioco, inseguimento, annusamento, leccata e contatto della bocca; oggetti presi, tenuti, trasportati, posati, lanciati, offerti o usati; carezze, cibo e altre interazioni visibili tra persone, animali e oggetti.`
    : `Look for the most informative action among posture and movement; play, chase, sniffing, licking and visible mouth contact; objects picked up, held, carried, put down, thrown, offered or used; petting, feeding and other visible interactions among people, animals and objects.`
  const prompt = italian
    ? `Rispondi soltanto con una concreta osservazione della videocamera in italiano. ${sequenceGrounding} ${grounding} ${generalVocabulary} ${focus} Se più soggetti rilevati partecipano chiaramente, menzionali senza inventare relazioni. Unisci il movimento misurato con gesto, postura o espressione visibile. Per persone e animali puoi dire "espressione" o "linguaggio corporeo compatibile con", senza affermare un'emozione certa. Scrivi una frase naturale completa con un verbo. Non elencare dettagli assenti e non citare istruzioni, lingua, detector o modello. Massimo 22 parole. Se manca un dettaglio affidabile, rispondi SAME.`
    : `Return only one concrete camera observation in English. ${sequenceGrounding} ${grounding} ${generalVocabulary} ${focus} If several detected subjects clearly participate, mention them without inventing relationships. Combine measured movement with the visible gesture, posture, or expression. For people and animals you may say "expression" or "body language consistent with", without claiming a certain emotion. Write a complete natural sentence with a verb. Never list absent details or mention instructions, language, detector, or model. At most 22 words. If no reliable detail is visible, reply SAME.`
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
  const referencesLayout=/\b(frame|frames|fotogramma|fotogrammi|crop|column|columns|colonna|colonne)\b/i.test(firstSentence)
  const ungroundedObject=!hasObject&&/\b(toy|ball|rope|stick|bowl|food|treat|object|gioco|palla|corda|bastone|ciotola|cibo|premietto|oggetto)\b/i.test(firstSentence)
  if (!firstSentence || /^same[.!]?$/i.test(firstSentence) || leakedPrompt || unhelpful || referencesLayout || ungroundedObject || firstSentence.length > 240) return null
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
  const meaningfulAction=/\b(play|chase|sniff|lick|bite|chew|eat|drink|pull|hold|carry|pick|throw|offer|use|pet|feed|hug|touch|gioc|insegu|annus|lecc|mord|mastic|mangi|bev|tir|tien|trasport|raccogl|lanci|porg|us|accarezz|abbracc|tocc)\w*/i.test(summary)
  let motionFused = movements.length > 0 && (meaningfulAction||/\b(move|walk|run|dance|jump|step|spost|cammin|corr|ball|salt)\w*/i.test(summary))
  if (movements.length && !motionFused) {
    const movement = facts.find((item) => item.motionText&&(!hasDog||dogSeenInSummary||item.label!=='dog'))
    if(movement){const rawName=String(movement.name || movement.label || '').trim(),subject=italian ? rawName === 'persona' ? 'la persona' : rawName : rawName === 'person' ? 'the person' : rawName;summary=`${summary.replace(/[.!?]+$/,'')}${italian?', mentre ':' while '}${subject} ${movement.motionText}.`;motionFused=true}
  }
  const dogVerified = !hasDog || dogSeenInSummary
  if(hasDog&&!dogVerified)kind=labels.includes('person')?'human':'object'
  return { summary, confidence, kind, motionFused, dogVerified, evidence:{frames:frameCount,detector:Number(detectorSupport.toFixed(3)),motion:Boolean(movements.length),face:Boolean(faceSignals.length),pose:Boolean(poseSignals.length)} }
}

const allowedActions=new Set(['standing','sitting','lying','sleeping','resting','walking','running','jumping','approaching','leaving','following','playing','chasing','sniffing','licking','biting','chewing','eating','drinking','tail_wagging','petting','feeding','facial_gesture','reaching','pointing','waving','touching','hugging','holding','carrying','picking_up','putting_down','throwing','offering','using_object','urinating','defecating','other'])
const highSpecificityActions=new Set(['sleeping','biting','eating','drinking','hugging','urinating','defecating'])

async function callVisionPsy(messages,max_tokens=220){
  if(!visionpsyReady&&!(await ensureVisionPsy()))throw new Error('VisionPsy local endpoint unavailable')
  const response=await fetch(visionpsyEndpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'visionpsy',max_tokens,temperature:.05,top_p:.25,messages}),signal:AbortSignal.timeout(45_000)})
  if(!response.ok)throw new Error(`VisionPsy ${response.status}`)
  const payload=await response.json()
  return String(payload?.choices?.[0]?.message?.content||'').replace(/\s+/g,' ').trim()
}

// This later declaration intentionally replaces the original single-caption
// interpreter while preserving it above as a readable compatibility reference.
async function interpretFrame(jpeg,facts=[],language='en',frameCount=1){
  const italian=language==='it',image=`data:image/jpeg;base64,${jpeg.toString('base64')}`
  const labels=facts.map(item=>item.label).filter(Boolean).slice(0,8),names=facts.map(item=>item.name).filter(Boolean).slice(0,8)
  const movements=facts.filter(item=>item.motionText).map(item=>`${item.name||item.label}: ${item.motionText}`).slice(0,5)
  const faceSignals=facts.flatMap(item=>Array.isArray(item.faceCues)?item.faceCues.map(cue=>`${item.name||item.label}: ${cue.text}`):[]).slice(0,3)
  const poseSignals=facts.flatMap(item=>Array.isArray(item.poseCues)?item.poseCues.map(cue=>`${item.name||item.label}: ${cue.text}`):[]).slice(0,4)
  const handSignals=facts.flatMap(item=>Array.isArray(item.handCues)?item.handCues.map(cue=>`${item.name||item.label}: ${cue.text}`):[]).slice(0,3)
  const dogPairHint=labels.filter(label=>label==='dog').length>=2?'Two distinct dogs are tracked. Never describe either dog as a toy or object.':''
  const grounding=`Tracked candidates: ${labels.join(', ')||'none'}. Names: ${names.join(', ')||'none'}. ${dogPairHint} Measured motion: ${movements.join('; ')||'none'}. Face cues: ${faceSignals.join('; ')||'none'}. Animal pose cues: ${poseSignals.join('; ')||'none'}. Hand-contact cues: ${handSignals.join('; ')||'none'}.`
  const animalLabels=new Set(['bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe']),hasAnimal=labels.some(label=>animalLabels.has(label)),hasPerson=labels.includes('person'),hasObject=labels.some(label=>label!=='person'&&!animalLabels.has(label))
  const requestedActions=new Set(['standing','sitting','lying','resting','walking','running','jumping','approaching','leaving','other'])
  if(hasAnimal)for(const action of ['sleeping','following','playing','chasing','sniffing','licking','biting','chewing','eating','drinking','tail_wagging'])requestedActions.add(action)
  if(hasPerson)for(const action of ['facial_gesture','reaching','pointing','waving','touching','hugging','holding','carrying','picking_up','putting_down','throwing','offering','using_object'])requestedActions.add(action)
  if(hasPerson&&hasAnimal)for(const action of ['petting','feeding','playing','touching','offering'])requestedActions.add(action)
  if(hasObject)for(const action of ['holding','carrying','picking_up','putting_down','throwing','offering','using_object'])requestedActions.add(action)
  if(hasAnimal)for(const action of ['urinating','defecating'])requestedActions.add(action)
  const actionList=[...requestedActions].join('|')
  const schema=`{"summary":"","context":"","events":[{"action":"${actionList}","actor":"","target":"","detail":"","confidence":0.0}]}`
  const task=italian
    ? `Costruisci una timeline essenziale da questa sequenza temporale: ogni colonna mostra la scena sopra e il crop del soggetto sotto, da sinistra a destra. Cerca in modo generale: (1) postura e locomozione di persone o animali; (2) oggetti presi, tenuti, trasportati, posati, lanciati, offerti o usati; (3) interazioni persona-persona, persona-animale, animale-animale e soggetto-oggetto; (4) gesti di mani, testa e viso; (5) annusare, leccare, inseguire, giocare, masticare, mangiare, bere, carezze e alimentazione. Riporta soltanto cambiamenti visibili sostenuti da più fotogrammi. Per dormire, mordere, mangiare, bere, abbracciare, urinare o defecare servono geometria inequivocabile e conferma in almeno due colonne. "Morde" indica solo contatto visibile bocca-oggetto o bocca-soggetto: non dedurre aggressività, intenzioni, identità o emozioni. Il contesto va nominato solo se chiaramente visibile e utile all'azione. Ometti eventi incerti senza commentarli. Scrivi summary e detail in italiano.`
    : `Build a sparse event timeline from this temporal sequence: each column shows the scene above and a subject crop below, ordered left to right. Look generally for: (1) posture and locomotion of people or animals; (2) objects picked up, held, carried, put down, thrown, offered or used; (3) person-person, person-animal, animal-animal and subject-object interactions; (4) hand, head and facial gestures; (5) sniffing, licking, chasing, play, chewing, eating, drinking, petting and feeding. Report only visible changes supported across multiple frames. Sleeping, biting, eating, drinking, hugging, urinating or defecating require unmistakable geometry confirmed in at least two columns. "Biting" means only visible mouth-to-object or mouth-to-subject contact: do not infer aggression, intent, identity or emotions. Name context only when clearly visible and useful to the action. Silently omit uncertain events.`
  const raw=await callVisionPsy([{role:'user',content:[{type:'image_url',image_url:{url:image}},{type:'text',text:`${task} ${grounding} Return only strict JSON matching: ${schema}`}]}],260)
  const structured=extractJson(raw)
  if(visionpsyDebug)console.log('[VisionPsy structured]',raw)
  if(!structured)return interpretFrameLegacy(jpeg,facts,language,frameCount)
  const detectorSupport=facts.length?Math.max(...facts.map(item=>Number(item.score)||0)):0
  const events=(Array.isArray(structured.events)?structured.events:[]).map(event=>({action:allowedActions.has(event.action)?event.action:'other',actor:String(event.actor||'').slice(0,60),target:String(event.target||'').slice(0,60),detail:String(event.detail||'').slice(0,180),confidence:Math.max(0,Math.min(1,Number(event.confidence)||0))})).filter(event=>event.detail&&event.confidence>=(highSpecificityActions.has(event.action)?.72:.58)).slice(0,4)
  const proposedSummary=String(structured.summary||'').replace(/\s+/g,' ').trim(),copiedSchema=/^(one factual sentence|una frase|factual sentence|summary)$/i.test(proposedSummary)
  const summary=String(copiedSchema?'':proposedSummary||events[0]?.detail||'').replace(/\s+/g,' ').trim().slice(0,240)
  if(!summary||/\b(cannot|unable|not clear|non posso|non chiaro|incerto|uncertain)\b/i.test(summary))return interpretFrameLegacy(jpeg,facts,language,frameCount)
  const confidence=events.length?Math.max(...events.map(event=>event.confidence)):Math.min(.85,.45+detectorSupport*.3)
  const hasDog=labels.includes('dog'),dogSeen=/\b(dog|dogs|cane|cani|cucciol)\b/i.test(`${summary} ${events.map(event=>`${event.actor} ${event.target}`).join(' ')}`)
  const kind=events.some(event=>['playing','chasing','petting','feeding','biting','hugging','touching','offering'].includes(event.action))?'interaction':events.some(event=>['facial_gesture','reaching','pointing','waving'].includes(event.action))?'human':hasDog?'dog':'object'
  return {summary,context:String(structured.context||'').slice(0,100),events,confidence,kind,motionFused:false,dogVerified:!hasDog||dogSeen,evidence:{frames:frameCount,detector:Number(detectorSupport.toFixed(3)),motion:Boolean(movements.length),face:Boolean(faceSignals.length),pose:Boolean(poseSignals.length),hands:Boolean(handSignals.length)}}
}

async function summarizeEvents(items=[],language='en'){
  const observed=items.filter(item=>item&&item.detail&&!/^(one factual sentence|una frase)$/i.test(String(item.detail||'').replace(/ · \d+%$/,'').trim())&&!String(item.stableKey||'').startsWith('detected:')&&!String(item.stableKey||'').startsWith('dog-pose:')).slice(-120)
  const meaningful=/\b(play|chase|sniff|lick|bite|mouth|chew|eat|drink|pull|hold|carry|pick|throw|offer|use|pet|feed|hug|touch|together|close|gioc|insegu|annus|lecc|mord|bocca|mastic|mangi|bev|tir|tien|trasport|raccogl|lanci|porg|us|accarezz|abbracc|tocc|insieme|vicin)\w*/i
  const semantic=observed.filter(item=>String(item.stableKey||'').startsWith('hand:')||String(item.stableKey||'').startsWith('dogs:')||String(item.stableKey||'').startsWith('dog-interest:')||(String(item.stableKey||'').startsWith('semantic:')&&meaningful.test(String(item.detail||''))))
  const selected=(semantic.length?semantic:observed).sort((first,second)=>(Number(first.videoSeconds)||0)-(Number(second.videoSeconds)||0))
  const clean=selected.map(item=>{const title=String(item.title||'').slice(0,80),rawDetail=String(item.detail||'').replace(/ · \d+%$/,'').slice(0,220),subject=title.replace(/\s*[·—-]\s*(Activity|Attività).*$/i,'').trim(),detail=String(item.stableKey||'').startsWith('temporal:')&&/^(moved|si è|ha cambiato)/i.test(rawDetail)&&subject?`${subject} ${rawDetail}`:rawDetail;return {title,detail,confidence:Number(item.confidence)||null,at:Number(item.videoSeconds)||null}})
  if(!clean.length)return null
  const italian=language==='it'
  const seen=new Set(),distinct=[]
  for(const item of clean){const key=item.detail.toLowerCase().replace(/\d+/g,'').replace(/[^a-zà-ÿ ]/g,'').replace(/\s+/g,' ').trim();if(!key||seen.has(key))continue;seen.add(key);distinct.push(item.detail.replace(/[.!?]+$/,''));if(distinct.length===6)break}
  const lowerFirst=text=>text?text.charAt(0).toLowerCase()+text.slice(1):text
  const deterministic=distinct.map((detail,index)=>index===0?(italian?`Nel video, ${lowerFirst(detail)}`:`In the video, ${lowerFirst(detail)}`):index===1?(italian?`Poco dopo, ${lowerFirst(detail)}`:`Shortly afterwards, ${lowerFirst(detail)}`):(italian?`Inoltre, ${lowerFirst(detail)}`:`Also, ${lowerFirst(detail)}`)).join('. ')+'.'
  const prompt=italian
    ? `Rielabora gli eventi osservati di un video in un paragrafo breve, naturale e concreto. Racconta in ordine il cambiamento più interessante: movimenti e posture, oggetti usati, interazioni tra persone e animali, gesti del corpo e del viso. Usa esclusivamente fatti presenti negli eventi, elimina duplicati, percentuali e dettagli tecnici. Non aggiungere emozioni, motivazioni, avvertenze o fatti non osservati. JSON eventi: ${JSON.stringify(clean)}`
    : `Turn the observed video events into one short, natural, concrete paragraph. Tell the most interesting visible change in order: movement and posture, objects being used, interactions among people and animals, and body or facial gestures. Use only facts present in the events; remove duplicates, percentages and technical details. Add no emotions, motives, caveats or unobserved facts. Events JSON: ${JSON.stringify(clean)}`
  const raw=await callVisionPsy([{role:'user',content:prompt}],180)
  const text=String(extractJson(raw)?.summary||raw).replace(/^```|```$/g,'').trim(),looksLikeData=/^[\[{]/.test(text)||/"title"\s*:|"detail"\s*:/.test(text),addsNegatives=/\b(no other|none of|not present|not observed|nothing else|no interactions?|there (?:was|were|are) no|neutral|nessun altr|non (?:è|sono|si vede|compare)|non ci sono|non presente|eventi osservati|observed video events|video events?|events? indicate)\b/i.test(text)
  return text&&!looksLikeData&&!addsNegatives&&text.length<700?text:deterministic
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      await Promise.all([detectorHealth(),visionpsyHealth()])
      return json(res, 200, {
        detector: { ready: detectorReady, engine: '@qvac/onnx · Core ML', reason: detectorReason },
        animalPose: { enabled: poseReady, engine: poseReady?'@qvac/onnx · RTMPose AP-10K':'not connected', provider: poseReady?'QVAC auto_gpu (Core ML requested)':null },
        visionpsy: { enabled: visionpsyReady, engine: visionpsyReady ? 'VisionPsy local' : 'starting or not connected' },
        facialCues: { enabled: fs.existsSync(faceLandmarkerModel), engine: 'MediaPipe Face Landmarker · local WASM' },
        handCues: { enabled: fs.existsSync(handLandmarkerModel), engine: 'MediaPipe Hand Landmarker · local WASM' },
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
      if (!visionpsyReady && !(await ensureVisionPsy())) return json(res, 503, { error: 'VisionPsy local endpoint not ready' })
      const jpeg = await readBody(req)
      let facts = []
      try { facts = JSON.parse(String(req.headers['x-vision-facts'] || '[]')) } catch {}
      const language = req.headers['x-language'] === 'it' ? 'it' : 'en'
      const frameCount = Math.max(1,Math.min(3,Number(req.headers['x-frame-count'])||1))
      const observation = await interpretFrame(jpeg, Array.isArray(facts) ? facts : [], language, frameCount)
      return json(res, observation ? 200 : 422, observation || { error: 'No structured observation' })
    }
    if (req.method === 'POST' && url.pathname === '/api/session-summary') {
      if (!visionpsyReady && !(await ensureVisionPsy())) return json(res,503,{error:'VisionPsy local endpoint not ready'})
      const body=await readBody(req,600_000)
      let input={}
      try{input=JSON.parse(body.toString('utf8'))}catch{return json(res,400,{error:'invalid JSON'})}
      const summary=await summarizeEvents(Array.isArray(input.events)?input.events:[],input.language==='it'?'it':'en')
      return json(res,summary?200:422,summary?{summary}:{error:'No grounded summary'})
    }
    if (req.method === 'POST' && url.pathname === '/api/youtube/resolve') {
      const body=await readBody(req,20_000)
      let input={}
      try{input=JSON.parse(body.toString('utf8'))}catch{return json(res,400,{error:'Invalid JSON'})}
      try{
        const source=await resolveYoutubeVideo(input.url)
        return json(res,200,{title:source.title,duration:source.duration,mediaUrl:`/api/youtube/media/${source.token}`})
      }catch(error){return json(res,422,{error:String(error?.message||error).split('\n')[0].slice(0,300)})}
    }
    const youtubeMediaMatch=url.pathname.match(/^\/api\/youtube\/media\/([a-f0-9-]+)$/i)
    if ((req.method === 'GET'||req.method === 'HEAD') && youtubeMediaMatch) {
      const entry=youtubeStreams.get(youtubeMediaMatch[1])
      if(!entry)return json(res,404,{error:'YouTube session expired'})
      return proxyYoutubeVideo(req,res,entry)
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
ensureVisionPsy().catch(()=>{})
server.listen(port, '127.0.0.1', () => console.log(`VisionPsy Studio ready at http://127.0.0.1:${port}`))

function close() {
  detector?.kill('SIGTERM')
  server.close(() => process.exit(0))
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
