import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOISE_ACTIONS, canonicalAction } from './public/narrative-engine-v2.js'
import { parseVisionStructuredPayload, validateStructuredVision, conservativeVisionFallback, reconcileV3Events, selectDeepV3StoryEvents, cleanNaturalLanguageObservation, isVisionSchemaEcho } from './public/deep-video-v3.js'

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
  const objectGrounding=hasObject?'Detector-backed objects are strong evidence; describe only an unmistakable stable interaction.':'No detector object is available. A generic or visually obvious object may be reported only when the same object persists across at least two sequence frames at conservative confidence; never name a specific uncommon object from one ambiguous frame.'
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
  const detectorSupport=facts.length?Math.max(...facts.map(item=>Number(item.score)||0)):0,confidence=Math.min(.9,.42+detectorSupport*.35+(frameCount > 1 ? .04 : 0)+(movements.length ? .035 : 0)+(faceSignals.length ? .035 : 0)+(poseSignals.length ? .04 : 0))
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

const allowedActions=new Set(['standing','sitting','lying','sleeping','resting','crouching','walking','running','jumping','approaching','leaving','following','playing','chasing','sniffing','licking','biting','mouth_contact','chewing','eating','drinking','tail_wagging','petting','feeding','facial_gesture','reaching','pointing','waving','touching','hugging','holding','carrying','picking_up','putting_down','dropping','throwing','offering','using_object','tugging','fetching','sitting_down','standing_up','lying_down','rolling','rubbing','shaking','stretching','scratching','mouth_open','tongue_visible','head_tilt','jumping_on','jumping_off','entering','crossing','climbing','descending','dog_dog_interaction','person_dog_interaction','scene_change','urinating','defecating','other'])
const highSpecificityActions=new Set(['sleeping','biting','eating','drinking','hugging','urinating','defecating'])

export class VisionPsyHttpError extends Error{
  constructor({status,body='',visual_mode='unknown',image_count=0}={}){const details={status:Number(status)||0,body:String(body||'').slice(0,4000),visual_mode,image_count:Number(image_count)||0};super(`VisionPsy HTTP ${details.status}: ${details.body||'empty response body'}`);this.name='VisionPsyHttpError';Object.assign(this,details);this.details=details}
}

async function callVisionPsy(messages,max_tokens=220,requestContext={}){
  if(!visionpsyReady&&!(await ensureVisionPsy()))throw new Error('VisionPsy local endpoint unavailable')
  const imageCount=messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(item=>item?.type==='image_url').length,visualMode=requestContext.visual_mode||(imageCount>1?'multi_image':imageCount===1?'single_image':'text')
  const response=await fetch(visionpsyEndpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'visionpsy',max_tokens,temperature:.05,top_p:.25,messages}),signal:AbortSignal.timeout(45_000)})
  const responseBody=await response.text();if(!response.ok)throw new VisionPsyHttpError({status:response.status,body:responseBody,visual_mode:visualMode,image_count:imageCount})
  const payload=JSON.parse(responseBody)
  return String(payload?.choices?.[0]?.message?.content||'').replace(/\s+/g,' ').trim()
}

// This later declaration intentionally replaces the original single-caption
// interpreter while preserving it above as a readable compatibility reference.
async function interpretFrame(jpeg,facts=[],language='en',frameCount=1,trigger=null){
  const italian=language==='it',image=`data:image/jpeg;base64,${jpeg.toString('base64')}`
  const labels=facts.map(item=>item.label).filter(Boolean).slice(0,8),names=facts.map(item=>item.name).filter(Boolean).slice(0,8)
  const movements=facts.filter(item=>item.motionText).map(item=>`${item.name||item.label}: ${item.motionText}`).slice(0,5)
  const faceSignals=facts.flatMap(item=>Array.isArray(item.faceCues)?item.faceCues.map(cue=>`${item.name||item.label}: ${cue.text}`):[]).slice(0,3)
  const poseSignals=facts.flatMap(item=>Array.isArray(item.poseCues)?item.poseCues.map(cue=>`${item.name||item.label}: ${cue.text}`):[]).slice(0,4)
  const handSignals=facts.flatMap(item=>Array.isArray(item.handCues)?item.handCues.map(cue=>`${item.name||item.label}: ${cue.text}`):[]).slice(0,3)
  const dogPairHint=labels.filter(label=>label==='dog').length>=2?'Two distinct dogs are tracked. Never describe either dog as a toy or object.':''
  const grounding=`Tracked candidates: ${labels.join(', ')||'none'}. Names: ${names.join(', ')||'none'}. ${dogPairHint} Measured motion is telemetry, not a story event: ${movements.join('; ')||'none'}. Face cues: ${faceSignals.join('; ')||'none'}. Animal pose cues: ${poseSignals.join('; ')||'none'}. Hand-contact cues: ${handSignals.join('; ')||'none'}. Semantic trigger: ${JSON.stringify(trigger||{type:'baseline'})}.`
  const animalLabels=new Set(['bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe']),hasAnimal=labels.some(label=>animalLabels.has(label)),hasPerson=labels.includes('person'),hasObject=labels.some(label=>label!=='person'&&!animalLabels.has(label))
  const requestedActions=new Set(['standing','sitting','lying','resting','crouching','walking','running','jumping','approaching','leaving','sitting_down','standing_up','lying_down','rolling','rubbing','shaking','stretching','scratching','jumping_on','jumping_off','entering','crossing','scene_change','other'])
  if(hasAnimal)for(const action of ['sleeping','following','playing','chasing','sniffing','licking','biting','mouth_contact','chewing','eating','drinking','tail_wagging','mouth_open','tongue_visible','head_tilt','tugging','fetching','climbing','descending','dog_dog_interaction'])requestedActions.add(action)
  if(hasPerson)for(const action of ['facial_gesture','reaching','pointing','waving','touching','hugging','holding','carrying','picking_up','putting_down','throwing','offering','using_object'])requestedActions.add(action)
  if(hasPerson&&hasAnimal)for(const action of ['petting','feeding','playing','touching','offering','person_dog_interaction'])requestedActions.add(action)
  if(hasObject)for(const action of ['holding','carrying','picking_up','putting_down','throwing','offering','using_object'])requestedActions.add(action)
  if(hasAnimal)for(const action of ['urinating','defecating'])requestedActions.add(action)
  const actionList=[...requestedActions].join('|')
  const schema=`{"summary":"","context":{"environment":"unknown","scene":"unknown","surface":"unknown","structures":[],"confidence":0.0},"events":[{"action":"${actionList}","actor":"","target":"","detail":"","confidence":0.0}]}`
  const task=italian
    ? `Costruisci una timeline essenziale dei cambiamenti visibili nella sequenza, non una descrizione dell'ultimo fotogramma. Collega più azioni quando formano un unico evento breve. Cerca postura e transizioni, superfici e ingressi/uscite, oggetti e loro stato, interazioni persona-cane e cane-cane, gesti e azioni specifiche. I movimenti sinistra/destra/alto/basso o verso la camera sono telemetria e non vanno narrati. Un oggetto non rilevato può essere generico soltanto se persiste in più fotogrammi; un nome specifico insolito richiede conferma ripetuta. Dormire, mordere, mangiare, bere, urinare o defecare richiedono geometria inequivocabile in almeno due colonne. Contatto con la bocca non significa aggressività; postura e volto non provano emozioni. Il contesto è un'ipotesi con confidenza: erba non implica automaticamente parco. Ometti eventi incerti. Scrivi summary e detail in italiano.`
    : `Build a sparse timeline of visible changes across the sequence, not a description of the last frame. Link several actions when they form one meaningful short event. Look for posture transitions, support surfaces and entry/exit, object state, person-dog and dog-dog relations, gestures and specific actions. Camera-relative left/right/up/down/closer motion is telemetry and must not be narrated. An undetected object may stay generic only when it persists across multiple frames; a specific uncommon name needs repeated confirmation. Sleeping, biting, eating, drinking, urinating or defecating require unmistakable geometry in at least two columns. Mouth contact is not aggression and posture or face does not prove emotion. Context is a confidence-bearing hypothesis: grass alone does not imply a park. Silently omit uncertain events.`
  const raw=await callVisionPsy([{role:'user',content:[{type:'image_url',image_url:{url:image}},{type:'text',text:`${task} ${grounding} Return only strict JSON matching: ${schema}`}]}],260)
  const structured=extractJson(raw)
  if(visionpsyDebug)console.log('[VisionPsy structured]',raw)
  if(!structured)return interpretFrameLegacy(jpeg,facts,language,frameCount)
  const detectorSupport=facts.length?Math.max(...facts.map(item=>Number(item.score)||0)):0
  const events=(Array.isArray(structured.events)?structured.events:[]).map(event=>({action:allowedActions.has(event.action)?event.action:'other',actor:String(event.actor||'').slice(0,60),target:String(event.target||'').slice(0,60),detail:String(event.detail||'').slice(0,180),confidence:Math.max(0,Math.min(1,Number(event.confidence)||0))})).filter(event=>event.detail&&event.confidence>=(highSpecificityActions.has(event.action) ? .72 : .58)).slice(0,4)
  const proposedSummary=String(structured.summary||'').replace(/\s+/g,' ').trim(),copiedSchema=/^(one factual sentence|una frase|factual sentence|summary)$/i.test(proposedSummary)
  const summary=String(copiedSchema?'':proposedSummary||events[0]?.detail||'').replace(/\s+/g,' ').trim().slice(0,240)
  if(!summary||/\b(cannot|unable|not clear|non posso|non chiaro|incerto|uncertain)\b/i.test(summary))return interpretFrameLegacy(jpeg,facts,language,frameCount)
  const confidence=events.length?Math.max(...events.map(event=>event.confidence)):Math.min(.85,.45+detectorSupport*.3)
  const hasDog=labels.includes('dog'),dogSeen=/\b(dog|dogs|cane|cani|cucciol)\b/i.test(`${summary} ${events.map(event=>`${event.actor} ${event.target}`).join(' ')}`)
  const kind=events.some(event=>['playing','chasing','petting','feeding','biting','hugging','touching','offering'].includes(event.action))?'interaction':events.some(event=>['facial_gesture','reaching','pointing','waving'].includes(event.action))?'human':hasDog?'dog':'object'
  const context=structured.context&&typeof structured.context==='object'?structured.context:String(structured.context||'').slice(0,160)
  return {summary,context,events,confidence,kind,motionFused:false,dogVerified:!hasDog||dogSeen,trigger,evidence:{frames:frameCount,detector:Number(detectorSupport.toFixed(3)),motion:Boolean(movements.length),face:Boolean(faceSignals.length),pose:Boolean(poseSignals.length),hands:Boolean(handSignals.length)}}
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

const narrativeNoiseActions=NOISE_ACTIONS
const narrativeContinuousActions=new Set(['petting','playing','chasing','sniffing','walking','running','chewing','tail_wagging','resting','sleeping','holding','carrying','following','dog_dog_interaction','person_dog_interaction'])

function normalizeV2Event(input={},defaults={}){
  const proposedAction=canonicalAction(input.action),start=Math.max(0,Number(input.start??defaults.start??0)||0),end=Math.max(start,Number(input.end??defaults.end??start)||start),confidence=Math.max(0,Math.min(1,Number(input.confidence)||0))
  if(narrativeNoiseActions.has(proposedAction)||!String(input.description||input.detail||'').trim())return null
  const action=allowedActions.has(proposedAction)?proposedAction:'other'
  if(highSpecificityActions.has(action)&&confidence<.72)return null
  return {id:String(input.id||`final_${Math.random().toString(36).slice(2,10)}`),start,end,actor:String(input.actor||'').slice(0,80)||null,action,target:String(input.target||'').slice(0,100)||null,from:input.from&&typeof input.from==='object'?input.from:null,to:input.to&&typeof input.to==='object'?input.to:null,objects:Array.isArray(input.objects)?input.objects.slice(0,4):[],modifiers:input.modifiers&&typeof input.modifiers==='object'?input.modifiers:{},evidence:input.evidence&&typeof input.evidence==='object'?input.evidence:{},confidence,importance:Math.max(0,Math.min(1,Number(input.importance)||.5)),description:String(input.description||input.detail).replace(/\s+/g,' ').trim().slice(0,260),source:String(input.source||defaults.source||'narrative-v2').slice(0,80),rawIds:Array.isArray(input.rawIds)?input.rawIds.slice(0,30):[]}
}

function v2EventKey(event){return [event.actor||'unknown',event.action,event.target||'',event.from?.surface||'',event.to?.surface||'',event.objects.map(item=>typeof item==='string'?item:item?.id||item?.label||'').sort().join(',')].join('|')}

function mergeV2Events(items=[]){
  const events=items.map(item=>normalizeV2Event(item)).filter(Boolean).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[],lastByKey=new Map()
  for(const event of events){const key=v2EventKey(event),previous=lastByKey.get(key),gap=narrativeContinuousActions.has(event.action)?2.8:1.6;if(previous&&event.start-previous.end<=gap){previous.end=Math.max(previous.end,event.end);previous.confidence=Math.max(previous.confidence,event.confidence);previous.importance=Math.max(previous.importance,event.importance);previous.evidence={...previous.evidence,...event.evidence};previous.rawIds=[...new Set([...previous.rawIds,...event.rawIds])];if(event.description.length>previous.description.length)previous.description=event.description}else{const added={...event};merged.push(added);lastByKey.set(key,added)}}
  return merged.sort((a,b)=>a.start-b.start)
}

function deterministicV2Summary(events=[],language='en'){
  const descriptions=events.map(event=>cleanNaturalLanguageObservation(event.description)||`${event.actor||(language==='it'?'Il soggetto':'The subject')} ${String(event.action||'acts').replaceAll('_',' ')}`).map(description=>description.replace(/[.!?]+$/,'').trim()).filter(Boolean).slice(0,8)
  if(!descriptions.length)return null
  const lower=text=>text?text.charAt(0).toLowerCase()+text.slice(1):text
  return descriptions.map((description,index)=>index===0?(language==='it'?`Nel video, ${lower(description)}`:`In the video, ${lower(description)}`):index===1?(language==='it'?`Poi ${lower(description)}`:`Then ${lower(description)}`):(language==='it'?`Successivamente ${lower(description)}`:`Later ${lower(description)}`)).join('. ')+'.'
}

export function hasNarrativeSchemaContamination(text){const value=String(text||'').trim();return Boolean(value)&&(isVisionSchemaEcho(value)||/```|\{\s*"?events?"?\s*:|"actor_ref"|"action"\s*:|"target_ref"|\[\s*\{|\}\s*,?\s*\{|\b(?:schema|template|placeholder|example json|model output)\b/i.test(value))}

function groundedV2Summary(text,events=[]){
  if(!text||text.length>=800||hasNarrativeSchemaContamination(text)||/^(?:json\b|[\[{])/i.test(text)||/"(?:id|title|detail|events?|action|actor|target|objects?)"\s*:/i.test(text))return false
  if(/\b(happy|sad|aggressiv|felice|triste|arrabbiat|no other|not observed|non (?:è|sono) stato osservato)\b/i.test(text))return false
  const evidence=JSON.stringify(events).toLowerCase()
  const subjects=text.match(/\b(?:dog|cane|cat|gatto|person|persona)\s+\d+\b/gi)||[]
  if(subjects.some(subject=>!evidence.includes(subject.toLowerCase())))return false
  const actionTerms={
    petting:/\b(?:pet(?:s|ted|ting)?|accarezz\w*)\b/i,feeding:/\b(?:feed\w*|nutr\w*|d[àa]\s+da\s+mangiare)\b/i,
    playing:/\b(?:play\w*|gioc\w*)\b/i,chasing:/\b(?:chas\w*|insegu\w*)\b/i,sniffing:/\b(?:sniff\w*|annus\w*)\b/i,
    licking:/\b(?:lick\w*|lecc\w*)\b/i,biting:/\b(?:bit(?:e|es|ing)|mord\w*)\b/i,chewing:/\b(?:chew\w*|mastic\w*)\b/i,
    eating:/\b(?:eat\w*|mangi\w*)\b/i,drinking:/\b(?:drink\w*|bev\w*)\b/i,sleeping:/\b(?:sleep\w*|dorm\w*)\b/i,
    urinating:/\b(?:urin\w*|pip[iì])\b/i,defecating:/\b(?:defec\w*|cacca)\b/i,fetching:/\b(?:fetch\w*|riport\w*)\b/i,
    tugging:/\b(?:tug\w*|trazion\w*)\b/i,tail_wagging:/\b(?:wag\w*|scodinzol\w*)\b/i
  }
  const actions=new Set(events.map(event=>event.action))
  return !Object.entries(actionTerms).some(([action,pattern])=>pattern.test(text)&&!actions.has(action))
}

export function sanitizeFinalNarrative(text,events=[],language='en'){const candidate=String(text||'').replace(/^```(?:json)?|```$/gi,'').trim();return groundedV2Summary(candidate,events)?candidate:deterministicV2Summary(events,language)}

function selectV2StoryEvents(items=[],sessionDuration=0,maxEvents=8){
  const events=mergeV2Events(items).filter(event=>event.confidence>=.48),duration=sessionDuration||Math.max(...events.map(event=>event.end),1)
  if(!events.length)return []
  const scored=events.map(event=>{const span=Math.min(1,Math.max(0,event.end-event.start)/6),continuous=narrativeContinuousActions.has(event.action)?span*.06:0;return {...event,_score:event.importance*.5+event.confidence*.36+continuous+.08}}),bins=[[],[],[],[]],chosen=[],ids=new Set()
  for(const event of scored){const midpoint=(event.start+event.end)/2,index=Math.min(3,Math.floor(midpoint/Math.max(duration,.001)*4));bins[index].push(event)}
  for(const bin of bins){const best=bin.sort((a,b)=>b._score-a._score)[0];if(best){chosen.push(best);ids.add(best.id)}}
  for(const event of [...scored].sort((a,b)=>b._score-a._score)){if(chosen.length>=maxEvents)break;if(!ids.has(event.id)){chosen.push(event);ids.add(event.id)}}
  return chosen.sort((a,b)=>a.start-b.start).map(({_score,...event})=>event)
}

async function summarizeV2Events(items=[],language='en',context={},sessionDuration=0){
  const events=selectV2StoryEvents(items,sessionDuration,8),deterministic=deterministicV2Summary(events,language)
  if(!events.length)return null
  const facts=events.map(({id,start,end,actor,action,target,from,to,objects,confidence,description})=>({id,start,end,actor,action,target,from,to,objects,confidence,description}))
  const prompt=language==='it'
    ? `Sei soltanto il realizzatore linguistico di una storia video. Scrivi un paragrafo breve, concreto e cronologico usando esclusivamente gli eventi JSON forniti. Conserva attore, azione, oggetto, superfici e ordine temporale. Puoi unire eventi continui ma non aggiungere emozioni, intenzioni, cause, oggetti o azioni assenti. Non menzionare detector, confidenza o dati mancanti. Contesto ipotetico (usalo solo se non contraddice gli eventi): ${JSON.stringify(context)}. Eventi: ${JSON.stringify(facts)}`
    : `You are only the language realizer for a video story. Write one short, concrete chronological paragraph using exclusively the supplied JSON events. Preserve actor, action, object, surfaces and temporal order. You may combine continuous events but must not add emotions, intent, causes, objects or actions absent from the events. Do not mention detectors, confidence or missing data. Hypothetical context (use only if consistent with events): ${JSON.stringify(context)}. Events: ${JSON.stringify(facts)}`
  try{const raw=await callVisionPsy([{role:'user',content:prompt}],220),text=String(extractJson(raw)?.summary||raw).trim();return sanitizeFinalNarrative(text,events,language)||deterministic}catch{return deterministic}
}

async function reviewEvidenceSequence(sequence,candidates=[],language='en'){
  if(!sequence?.image||!/^data:image\/jpeg;base64,/.test(sequence.image))return null
  const schema='{"confidence":0.0,"confirmedIds":[],"rejectedIds":[],"events":[{"action":"allowed action","actor":"","target":"","detail":"","confidence":0.0}],"context":{"environment":"unknown","scene":"unknown","surface":"unknown","structures":[],"confidence":0.0}}'
  const prompt=language==='it'
    ? `Revisione finale limitata di una sequenza temporale. Conferma o respingi gli eventi candidati soltanto se l'evidenza visiva li supporta. Puoi proporre un nuovo evento solo se è chiaramente visibile attraverso più fotogrammi; mai movimento relativo alla camera. Azioni ad alta specificità richiedono evidenza inequivocabile. Contatto con la bocca non è aggressività; erba non implica parco. Candidati: ${JSON.stringify(candidates)}. Restituisci solo JSON: ${schema}`
    : `Bounded final review of a temporal sequence. Confirm or reject candidate events only when supported by the visual evidence. Propose a new event only when it is clearly visible across multiple frames; never report camera-relative movement. High-specificity actions require unmistakable evidence. Mouth contact is not aggression and grass does not imply a park. Candidates: ${JSON.stringify(candidates)}. Return only JSON: ${schema}`
  try{const raw=await callVisionPsy([{role:'user',content:[{type:'image_url',image_url:{url:sequence.image}},{type:'text',text:prompt}]}],260),parsed=extractJson(raw);return parsed?{...parsed,raw}:null}catch{return null}
}

async function finalizeV2Session(input={}){
  let events=mergeV2Events(Array.isArray(input.events)?input.events:[]),context=input.context&&typeof input.context==='object'?input.context:{},reviews=[]
  for(const sequence of (Array.isArray(input.evidenceSequences)?input.evidenceSequences:[]).slice(0,4)){
    const at=Number(sequence.at)||0,candidates=events.filter(event=>event.start<=at+5&&event.end>=at-5).map(event=>({id:event.id,start:event.start,end:event.end,actor:event.actor,action:event.action,target:event.target,description:event.description,confidence:event.confidence})),review=await reviewEvidenceSequence(sequence,candidates,input.language==='it'?'it':'en')
    if(!review)continue;reviews.push({at,confidence:Number(review.confidence)||0,confirmedIds:Array.isArray(review.confirmedIds)?review.confirmedIds:[],rejectedIds:Array.isArray(review.rejectedIds)?review.rejectedIds:[],raw:review.raw})
    const confidence=Math.max(0,Math.min(1,Number(review.confidence)||0));if(confidence>=.72){const confirmed=new Set(review.confirmedIds||[]),rejected=new Set(review.rejectedIds||[]);events=events.map(event=>confirmed.has(event.id)?{...event,confidence:Math.min(1,event.confidence+.04),evidence:{...event.evidence,finalReview:true}}:rejected.has(event.id)&&confidence>=.82?{...event,confidence:event.confidence*.72,evidence:{...event.evidence,finalRejected:true}}:event)}
    for(const proposed of (Array.isArray(review.events)?review.events:[]).slice(0,3)){const threshold=highSpecificityActions.has(proposed.action) ? .82 : .72,normalized=normalizeV2Event({...proposed,start:Math.max(0,at-1.5),end:at+1.5,source:'final-visionpsy',importance:.7,evidence:{finalSequenceAt:at,frames:3}},{start:Math.max(0,at-1.5),end:at+1.5,source:'final-visionpsy'});if(normalized&&normalized.confidence>=threshold)events.push(normalized)}
    if(review.context&&typeof review.context==='object'&&Number(review.context.confidence)>=.75)context={...context,...review.context}
  }
  events=mergeV2Events(events).filter(event=>event.confidence>=.48);const summary=await summarizeV2Events(events,input.language==='it'?'it':'en',context,Number(input.sessionDuration)||0)
  return {version:2,events,summary,context,reviews}
}

const deepV3Actions=[...new Set(['petting','lying_down','standing_up','sitting_down','jumping_off','jumping_on','approaching_person','rear_up','tail_wagging','sniffing','object_presented','mouth_contact','picking_up','holding','carrying','playing','tugging','dropping','dog_dog_interaction','person_dog_interaction','resting','walking','running','rolling','biting','eating','drinking','urinating','defecating','other'])]
const deepV3ActionInstruction=`Choose exactly one action name per event from: ${deepV3Actions.join(', ')}.`
const deepV3FieldInstruction='Return one JSON object with an events array. Each event requires actor_ref as a string, action as one allowed action, confidence as a number from 0 to 1, and description as a short visible observation; target_ref is an optional string. Return {"events":[]} when no event is clear.'

let deepMultiImageCapability='unknown',deepMultiImageCapabilityError=null
export function resetDeepMultiImageCapability(){deepMultiImageCapability='unknown';deepMultiImageCapabilityError=null}
export function getDeepMultiImageCapability(){return deepMultiImageCapability}
function deepV3Metrics(){return {vision_calls:0,useful_vision_responses:0,valid_structured_responses:0,valid_structured_with_events:0,valid_structured_empty:0,repaired_responses:0,fallback_parsed_responses:0,discarded_responses:0,structured_events_created:0,multi_image_attempts:0,multi_image_successes:0,multi_image_failures:0,contact_sheet_fallback_windows:0}}
function usefulVisionText(raw){const text=String(raw||'').trim();return text.length>12&&!/^same\.?$/i.test(text)&&!/^\{?\s*"?events"?\s*:\s*\[\s*\]/i.test(text)}

export function buildDeepVisionContent(sequence={},grounding='',mode='multi_image'){const frames=(Array.isArray(sequence.frames)?sequence.frames:[]).filter(frame=>Number.isFinite(Number(frame?.timestamp))&&/^data:image\/jpeg;base64,/.test(String(frame?.image||''))).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));if(mode==='multi_image'&&frames.length>=2){const content=[];for(const [index,frame] of frames.entries()){content.push({type:'text',text:`Frame ${index+1}/${frames.length} · ${Number(frame.timestamp).toFixed(2)}s · ordered earliest to latest`},{type:'image_url',image_url:{url:frame.image}})}content.push({type:'text',text:grounding});return {content,visual_input:{mode:'multi_image',frame_count:frames.length,timestamps:frames.map(frame=>Number(frame.timestamp)),frame_dimensions:frames.map(frame=>({width:Number(frame.width)||null,height:Number(frame.height)||null}))}}}const sheet=sequence.contact_sheet||sequence;if(/^data:image\/jpeg;base64,/.test(String(sheet.image||'')))return {content:[{type:'image_url',image_url:{url:sheet.image}},{type:'text',text:grounding}],visual_input:{mode:'contact_sheet_fallback',frame_count:Number(sheet.frame_count)||frames.length||1,timestamps:Array.isArray(sheet.timestamps)?sheet.timestamps:frames.map(frame=>Number(frame.timestamp)),frame_dimensions:Array.isArray(sheet.frame_dimensions)?sheet.frame_dimensions:frames.map(frame=>({width:Number(frame.width)||null,height:Number(frame.height)||null}))}};throw new Error(mode==='multi_image'?'Deep window requires at least two ordered JPEG frames':'Deep window contact-sheet fallback unavailable')}

const serializeVisionError=(error,defaults={})=>({status:Number(error?.status)||0,body:String(error?.body||error?.message||error||'').slice(0,4000),visual_mode:error?.visual_mode||defaults.visual_mode||'unknown',image_count:Number(error?.image_count??defaults.image_count)||0})
const isUnsupportedMultiImageError=error=>Number(error?.status)===400&&(error?.visual_mode==='multi_image'||Number(error?.image_count)>1)

export async function analyseDeepWindow(input={},visionCall=callVisionPsy){
  const metrics=deepV3Metrics(),decisions=[],interval={start:Math.max(0,Number(input.interval?.start)||0),end:Math.max(0,Number(input.interval?.end)||0)},knownSubjects=Array.isArray(input.knownSubjects)?input.knownSubjects.slice(0,12):[]
  const language=input.language==='it'?'it':'en',semanticHint=String(input.interval?.semantic_hint||'').slice(0,300),visualScope=language==='it'
    ? 'Cerca qualsiasi comportamento significativo chiaramente visibile: cambio di postura, salto su o giù, contatto persona-cane, interazione tra cani, presentazione visibile di un oggetto, contatto della bocca con un oggetto, presa, trasporto, gioco, trazione o rilascio. La telemetria di detector e oggetti è solo evidenza di supporto: segnala un’interazione persistente con un oggetto chiaramente visibile anche se il detector non produce un candidato, ma non inventare oggetti non chiari.'
    : 'Inspect for any clearly visible meaningful pet behavior: posture change, jumping on or off, person-dog contact, dog-dog interaction, visible object presentation, mouth contact with an object, pickup, holding or carrying, playing, tugging, or dropping. Detector/object telemetry is a supporting signal only. If a clearly visible persistent object interaction is present in the frames, report it even if no detector object candidate exists. Do not invent an object when not visually clear.',temporalScope=language==='it'?'Le immagini sono ordinate dalla prima all’ultima. Confronta fotogrammi consecutivi e identifica ciò che cambia nell’intervallo. Distingui carezze ripetute da un’interazione mano-oggetto-cane. Lo stato di un oggetto può cambiare tra presentato, contatto con la bocca, tenuto, trasportato, giocato o tirato e lasciato; segnala soltanto gli stadi chiaramente supportati dalle immagini.':'Images are ordered earliest to latest. Compare consecutive frames and identify what changes over the interval. Distinguish repeated stroking from hand/object interaction. Object state may change across frames from presented, to mouth contact, held or carried, played or tugged, and dropped; report only stages clearly supported by the images.',grounding=language==='it'
    ? `Osserva la sequenza cronologica nell'intervallo ${interval.start.toFixed(2)}–${interval.end.toFixed(2)} secondi. Soggetti consentiti: ${knownSubjects.join(', ')||'nessuno'}. Non inventare emozioni o movimento della fotocamera. ${temporalScope} ${visualScope} ${semanticHint} ${deepV3FieldInstruction} ${deepV3ActionInstruction}`
    : `Observe the chronological sequence in interval ${interval.start.toFixed(2)}–${interval.end.toFixed(2)} seconds. Allowed subjects: ${knownSubjects.join(', ')||'none'}. Do not infer emotions or camera movement. ${temporalScope} ${visualScope} ${semanticHint} ${deepV3FieldInstruction} ${deepV3ActionInstruction}`
  const frameCount=Array.isArray(input.sequence?.frames)?input.sequence.frames.length:0;let visualMessage,rawResponse,multiImageError=null
  if(frameCount>=2&&deepMultiImageCapability!=='unsupported'){
    visualMessage=buildDeepVisionContent(input.sequence,grounding,'multi_image');metrics.multi_image_attempts++;metrics.vision_calls++
    try{rawResponse=await visionCall([{role:'user',content:visualMessage.content}],420,{visual_mode:'multi_image',image_count:frameCount});metrics.multi_image_successes++;deepMultiImageCapability='supported'}catch(error){if(!isUnsupportedMultiImageError(error))throw error;metrics.multi_image_failures++;deepMultiImageCapability='unsupported';multiImageError=serializeVisionError(error,{visual_mode:'multi_image',image_count:frameCount});deepMultiImageCapabilityError=multiImageError}
  }
  if(rawResponse===undefined){multiImageError=multiImageError||deepMultiImageCapabilityError;try{visualMessage=buildDeepVisionContent(input.sequence,grounding,'contact_sheet_fallback')}catch(fallbackBuildError){const details={multi_image_error:multiImageError,fallback_error:serializeVisionError(fallbackBuildError,{visual_mode:'contact_sheet_fallback',image_count:1}),combined:true,error:'VisionPsy multi-image and contact-sheet fallback both failed'};const error=new Error(`${details.error}: ${JSON.stringify(details)}`);error.details=details;throw error}visualMessage.visual_input.multi_image_error=multiImageError;metrics.contact_sheet_fallback_windows++;metrics.vision_calls++;decisions.push({status:'accepted',stage:'visual_input',reason:'contact_sheet_fallback',interval});try{rawResponse=await visionCall([{role:'user',content:visualMessage.content}],420,{visual_mode:'contact_sheet_fallback',image_count:1})}catch(fallbackError){const details={multi_image_error:multiImageError,fallback_error:serializeVisionError(fallbackError,{visual_mode:'contact_sheet_fallback',image_count:1}),combined:true,error:'VisionPsy multi-image and contact-sheet fallback both failed'};const error=new Error(`${details.error}: ${JSON.stringify(details)}`);error.details=details;throw error}}
  if(usefulVisionText(rawResponse))metrics.useful_vision_responses++
  const parsedResponse=parseVisionStructuredPayload(rawResponse),initialSchemaEcho=isVisionSchemaEcho(rawResponse),fallbackObservation=cleanNaturalLanguageObservation(rawResponse),initialValidation=validateStructuredVision(rawResponse,{interval,knownSubjects});let validated=initialValidation,repaired=false,repairAttempted=false,repairedRawResponse=null,repairedParsedResponse=null,repairedValidation=null
  if(initialSchemaEcho){metrics.discarded_responses++;decisions.push({status:'rejected',stage:'initial_parse',reason:'schema_echo_or_template',interval})}
  if(!validated.valid&&!initialSchemaEcho){
    decisions.push(...validated.errors.map(reason=>({status:'rejected',stage:'initial_parse',reason,interval})));metrics.vision_calls++;repairAttempted=true
    const repairPrompt=language==='it'?`Ripara l'output seguente in JSON rigorosamente valido senza aggiungere fatti. Usa soltanto soggetti consentiti e limita i timestamp a ${interval.start}–${interval.end}. Output malformato: ${String(rawResponse).slice(0,5000)}. ${deepV3FieldInstruction} ${deepV3ActionInstruction}`:`Repair the following output into strict valid JSON without adding facts. Use only allowed subjects and keep timestamps within ${interval.start}–${interval.end}. Malformed output: ${String(rawResponse).slice(0,5000)}. ${deepV3FieldInstruction} ${deepV3ActionInstruction}`
    repairedRawResponse=await visionCall([{role:'user',content:repairPrompt}],420);repairedParsedResponse=parseVisionStructuredPayload(repairedRawResponse);repairedValidation=validateStructuredVision(repairedRawResponse,{interval,knownSubjects});if(repairedValidation.valid){validated=repairedValidation;repaired=true;metrics.repaired_responses++}else decisions.push(...repairedValidation.errors.map(reason=>({status:'rejected',stage:'repair_parse',reason,interval})))
  }
  let events=validated.valid?validated.events:[]
  if(validated.valid){metrics.valid_structured_responses++;if(validated.events.length){metrics.valid_structured_with_events++;metrics.structured_events_created=validated.events.length}else metrics.valid_structured_empty++}
  let fallbackUsed=false
  if(!events.length&&fallbackObservation&&!initialSchemaEcho){
    const actor=knownSubjects.find(value=>/^subject_/.test(value))||'subject_1',fallback=conservativeVisionFallback(fallbackObservation,{interval,actor,confidence:.72})
    if(fallback.length){events=fallback;fallbackUsed=true;metrics.fallback_parsed_responses++;decisions.push(...fallback.map(event=>({status:'accepted',stage:'fallback',event_id:event.id,reason:'conservative_recognizable_action'})))}
    else{metrics.discarded_responses++;decisions.push({status:'rejected',stage:'fallback',reason:'useful_response_without_grounded_recognizable_action',raw:String(rawResponse).slice(0,800),interval})}
  }
  decisions.push(...events.filter(event=>!decisions.some(item=>item.event_id===event.id)).map(event=>({status:'accepted',stage:repaired?'repair':'structured',event_id:event.id,reason:'validated_structured_event'})))
  const visionWindow={id:input.interval?.id||null,start:interval.start,end:interval.end,reasons:Array.isArray(input.interval?.reasons)?input.interval.reasons:[],subjects:Array.isArray(input.interval?.subjects)?input.interval.subjects:[],salience:Number(input.interval?.salience)||0,visual_input:visualMessage.visual_input,raw_response:String(rawResponse||'').slice(0,8000),parsed_response:parsedResponse,validation_result:{valid:validated.valid,event_count:validated.events.length,context:validated.context||null},validated_events:validated.events,validation_errors:validated.errors||[],normalization_applied:Boolean(validated.normalization_applied),normalized_payload:validated.normalized_payload||null,initial_validation_errors:initialValidation.errors||[],repair_attempted:repairAttempted,repaired_raw_response:repairedRawResponse===null?null:String(repairedRawResponse).slice(0,8000),repaired_parsed_response:repairedParsedResponse,repaired_validation_result:repairedValidation?{valid:repairedValidation.valid,event_count:repairedValidation.events.length,errors:repairedValidation.errors}:null,schema_echo_detected:initialSchemaEcho||isVisionSchemaEcho(repairedRawResponse),fallback_used:fallbackUsed}
  return {version:3,events,context:validated.context||{},metrics,decisions,repair_attempted:repairAttempted,raw_response:visionWindow.raw_response,vision_window:visionWindow}
}

async function finalizeDeepV3(input={}){
  const duration=Math.max(0,Number(input.sessionDuration)||0),knownSubjects=new Set((input.identity||[]).map(item=>item.subject_id).filter(Boolean)),identityReconciliation=[],safe=[],inputEvents=Array.isArray(input.events)?input.events:[],surfaceById=new Map((Array.isArray(input.surfaces)?input.surfaces:[]).map(surface=>[surface.surface_id,surface])),geometricTransitions=inputEvents.filter(event=>event.source==='surface-v3'&&['jumping_on','jumping_off'].includes(event.action))
  const stableSurface=reference=>{if(!reference||typeof reference!=='object')return reference;const entity=surfaceById.get(reference.surface_id);return entity?{...reference,surface:entity.stable_type||'furniture_surface'}:reference}
  for(const original of inputEvents){let raw=original,actor=String(raw.actor||raw.actor_ref||'');if(/^subject_/.test(actor)&&knownSubjects.size&&!knownSubjects.has(actor)){identityReconciliation.push({event_id:raw.id,status:'rejected',reason:'unknown_persistent_subject',actor});continue}if(hasNarrativeSchemaContamination(raw.description)){identityReconciliation.push({event_id:raw.id,status:'rejected',reason:'schema_contaminated_description',actor});continue}if(['jumping_on','jumping_off'].includes(raw.action)){const geometric=raw.source==='surface-v3'?raw:geometricTransitions.find(candidate=>candidate.actor===actor&&candidate.action===raw.action&&Math.max(candidate.start,raw.start)<=Math.min(candidate.end,raw.end)+1.5);if(!geometric){identityReconciliation.push({event_id:raw.id,status:'rejected',reason:'support_transition_without_geometric_change',actor});continue}const from=stableSurface(geometric.from),to=stableSurface(geometric.to);raw={...raw,from,to,description:`${actor||'The subject'} changes support from ${from?.surface||'floor'} to ${to?.surface||'floor'}.`}}safe.push(raw)}
  const reconciled=reconcileV3Events(safe,{sessionDuration:duration,maxEvents:12}),surfaceReconciliation=[]
  for(const event of reconciled.events){if(['jumping_on','jumping_off'].includes(event.action)){const fromId=event.from?.surface_id,toId=event.to?.surface_id;if(fromId&&toId&&fromId===toId){surfaceReconciliation.push({event_id:event.id,status:'rejected',reason:'same_surface_entity_label_flip'});event.confidence=0}}}
  const events=reconciled.events.filter(event=>event.confidence>=.48),story=selectDeepV3StoryEvents(events,{sessionDuration:duration,maxEvents:12}),summary=await summarizeV2Events(story,input.language==='it'?'it':'en',input.context||{},duration)
  return {version:3,events,story,summary,context:input.context||{},identity_reconciliation:identityReconciliation,surface_reconciliation:surfaceReconciliation,rejected:[...reconciled.rejected,...identityReconciliation,...surfaceReconciliation]}
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      await Promise.all([detectorHealth(),visionpsyHealth()])
      return json(res, 200, {
        studio: { build: 'agent/deep-video-v3', narrative: 'deep-recorded-v3', live: 'narrative-v2' },
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
      let trigger = null
      try { trigger = JSON.parse(String(req.headers['x-narrative-trigger'] || 'null')) } catch {}
      const language = req.headers['x-language'] === 'it' ? 'it' : 'en'
      const frameCount = Math.max(1,Math.min(3,Number(req.headers['x-frame-count'])||1))
      const observation = await interpretFrame(jpeg, Array.isArray(facts) ? facts : [], language, frameCount, trigger)
      return json(res, observation ? 200 : 422, observation || { error: 'No structured observation' })
    }
    if (req.method === 'POST' && url.pathname === '/api/session-summary') {
      const body=await readBody(req,600_000)
      let input={}
      try{input=JSON.parse(body.toString('utf8'))}catch{return json(res,400,{error:'invalid JSON'})}
      if(input.version===2||Array.isArray(input.events)&&input.events.some(event=>event&&event.action)){
        const summary=await summarizeV2Events(Array.isArray(input.events)?input.events:[],input.language==='it'?'it':'en',input.context||{},Number(input.sessionDuration)||0)
        return json(res,summary?200:422,summary?{version:2,summary}:{error:'No grounded Narrative V2 events'})
      }
      if (!visionpsyReady && !(await ensureVisionPsy())) return json(res,503,{error:'VisionPsy local endpoint not ready'})
      const summary=await summarizeEvents(Array.isArray(input.events)?input.events:[],input.language==='it'?'it':'en')
      return json(res,summary?200:422,summary?{summary}:{error:'No grounded summary'})
    }
    if (req.method === 'POST' && url.pathname === '/api/finalize-session') {
      const body=await readBody(req,8_000_000)
      let input={}
      try{input=JSON.parse(body.toString('utf8'))}catch{return json(res,400,{error:'invalid JSON'})}
      const result=await finalizeV2Session(input)
      return json(res,200,result)
    }
    if (req.method === 'POST' && url.pathname === '/api/deep/analyse-window') {
      if (!visionpsyReady && !(await ensureVisionPsy())) return json(res,503,{error:'VisionPsy local endpoint not ready'})
      const body=await readBody(req,10_000_000);let input={}
      try{input=JSON.parse(body.toString('utf8'))}catch{return json(res,400,{error:'invalid JSON'})}
      return json(res,200,await analyseDeepWindow(input))
    }
    if (req.method === 'POST' && url.pathname === '/api/deep/finalize') {
      const body=await readBody(req,4_000_000);let input={}
      try{input=JSON.parse(body.toString('utf8'))}catch{return json(res,400,{error:'invalid JSON'})}
      return json(res,200,await finalizeDeepV3(input))
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
      if (!['index.html', 'styles.css', 'app.js', 'narrative-engine-v2.js', 'deep-video-v3.js'].includes(requested)) return json(res, 404, { error: 'not found' })
      const file = path.join(publicDir, requested)
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'x-studio-build':'agent/deep-video-v3', 'cache-control':'no-store' })
      return fs.createReadStream(file).pipe(res)
    }
    return json(res, 404, { error: 'not found' })
  } catch (error) {
    return json(res, 500, { error: String(error?.message || error), ...(error?.details?{details:error.details}:{}) })
  }
})

function close() {
  detector?.kill('SIGTERM')
  server.close(() => process.exit(0))
}
const isMain=path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)
if(isMain){
  startDetector()
  ensureVisionPsy().catch(()=>{})
  server.listen(port, '127.0.0.1', () => console.log(`VisionPsy Studio ready at http://127.0.0.1:${port}`))
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
}
