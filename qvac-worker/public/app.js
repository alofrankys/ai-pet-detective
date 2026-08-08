const video = document.getElementById('camera')
const capture = document.getElementById('capture')
const overlay = document.getElementById('overlay')
const startButton = document.getElementById('startButton')
const fileButton = document.getElementById('fileButton')
const videoFile = document.getElementById('videoFile')
const languageSelect = document.getElementById('languageSelect')
const overlayToggle = document.getElementById('overlayToggle')
const emptyState = document.getElementById('emptyState')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const sceneText = document.getElementById('sceneText')
const sceneConfidence = document.getElementById('sceneConfidence')
const detectedList = document.getElementById('detectedList')
const fpsLabel = document.getElementById('fps')
const timeline = document.getElementById('timeline')
const captureCtx = capture.getContext('2d', { willReadFrequently:true })
const overlayCtx = overlay.getContext('2d')
const poseCrop = document.createElement('canvas')
poseCrop.width=256;poseCrop.height=256
const poseCropCtx = poseCrop.getContext('2d',{willReadFrequently:true})
const semanticContactSheet = document.createElement('canvas')
semanticContactSheet.width=640;semanticContactSheet.height=640
const semanticContactSheetCtx = semanticContactSheet.getContext('2d')

const animalLabels = new Set(['bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe'])
const quietLabels = new Set(['chair','couch','bed','dining table','potted plant'])
const environmentLabels = new Set(['chair','couch','bed','dining table','potted plant'])
const toyLabels = new Set(['sports ball','teddy bear','frisbee'])
const foodLabels = new Set(['banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake'])
const dogInterestLabels = new Set([...toyLabels,...foodLabels,'bowl'])
const categoryPalettes = {
  person:['#58b8ff','#7dd3fc','#65d6c4'],
  animal:['#72e29a','#ffb84d','#b892ff','#d6f36b'],
  object:['#ff6b8a','#f19cff','#f4f7f5','#ff8f5c']
}
const labels = {
  en:{person:'person',dog:'dog',cat:'cat','cell phone':'phone','sports ball':'ball','teddy bear':'teddy bear',frisbee:'frisbee',chair:'chair',couch:'couch',bed:'bed','dining table':'table','potted plant':'plant',mouse:'mouse',cup:'cup',bottle:'bottle',book:'book',banana:'banana',apple:'apple',sandwich:'sandwich',orange:'orange',broccoli:'broccoli',carrot:'carrot','hot dog':'food',pizza:'pizza',donut:'donut',cake:'cake',bowl:'bowl'},
  it:{person:'persona',dog:'cane',cat:'gatto','cell phone':'cellulare','sports ball':'palla','teddy bear':'peluche',frisbee:'frisbee',chair:'sedia',couch:'divano',bed:'letto','dining table':'tavolo','potted plant':'pianta',mouse:'mouse',cup:'tazza',bottle:'bottiglia',book:'libro',banana:'banana',apple:'mela',sandwich:'panino',orange:'arancia',broccoli:'broccolo',carrot:'carota','hot dog':'cibo',pizza:'pizza',donut:'ciambella',cake:'torta',bowl:'ciotola'}
}
const copy = {
  en:{language:'Language',labels:'Labels',heroTitle:'Make the scene readable.',heroCopy:'Use the camera or analyse a recorded video.',startCamera:'Start camera',openVideo:'Open video',all:'All',people:'People',animals:'Animals',objects:'Objects',scene:'SCENE',detected:'DETECTED',recentEvents:'RECENT EVENTS',waiting:'Waiting for a source',none:'Nothing detected',empty:'No clear subject in the foreground',shared:'share the scene',moving:'moving',still:'still',small:'small',medium:'medium',large:'large',appeared:'Detected',movement:'Movement',windowActivity:'Activity',together:'Moving together',togetherDetail:'Two dogs are close and moving',facialCue:'Facial cue',animalActivity:'Animal activity',interaction:'Interaction',visualDetail:'Visual detail',movedLeft:'moved left',movedRight:'moved right',movedUp:'moved upward',movedDown:'moved downward',closer:'came closer to the camera',farther:'moved farther from the camera',shifted:'changed position slightly',cameraError:'Camera unavailable',engine:'Starting engine…',qvacVision:'Local QVAC vision',qvacPsy:'Local QVAC + VisionPsy'},
  it:{language:'Lingua',labels:'Etichette',heroTitle:'La scena, resa leggibile.',heroCopy:'Usa la fotocamera o analizza un video registrato.',startCamera:'Avvia fotocamera',openVideo:'Apri video',all:'Tutto',people:'Persone',animals:'Animali',objects:'Oggetti',scene:'SCENA',detected:'RILEVATO',recentEvents:'EVENTI RECENTI',waiting:'In attesa di una sorgente',none:'Nessun elemento',empty:'Nessun soggetto in primo piano',shared:'condividono la scena',moving:'in movimento',still:'fermo',small:'piccolo',medium:'medio',large:'grande',appeared:'Rilevato',movement:'Movimento',windowActivity:'Attività',together:'Movimento insieme',togetherDetail:'Due cani sono vicini e in movimento',facialCue:'Segnale del viso',animalActivity:'Attività animale',interaction:'Interazione',visualDetail:'Dettaglio visivo',movedLeft:'si è spostato a sinistra',movedRight:'si è spostato a destra',movedUp:'si è spostato verso l’alto',movedDown:'si è spostato verso il basso',closer:'si è avvicinato alla fotocamera',farther:'si è allontanato dalla fotocamera',shifted:'ha cambiato leggermente posizione',cameraError:'Fotocamera non disponibile',engine:'Avvio del motore…',qvacVision:'Visione QVAC locale',qvacPsy:'QVAC + VisionPsy locali'}
}

let language = 'en'
let activeFilter = 'all'
let running = false
let busy = false
let timer = null
let tracks = []
let retiredTracks = []
let nextTrackId = 1
const subjectCounters = new Map()
const categoryColorCounters = new Map()
let visionpsyEnabled = false
let nextInterpretAt = 0
let interpreting = false
let lastFacts = []
let lastInterpretationAt = 0
const semanticFrames = []
let lastSemanticSampleAt = 0
let objectUrl = null
const events = []
const eventLastSeen = new Map()
const sceneHistory = []
const sceneMinimumHoldMs = 2800
let sceneLastAcceptedAt = 0
let pendingScene = null
let pendingSceneTimer = null
let faceLandmarker = null
let nextFaceCueAt = 0
let faceCues = []
let animalPoseEnabled = false
let nextAnimalPoseAt = 0

function t(key){ return copy[language][key] || copy.en[key] || key }
function category(label){ return label === 'person' ? 'person' : animalLabels.has(label) ? 'animal' : 'object' }
function displayLabel(label){ return labels[language][label] || label }
function subjectColor(label,number){const palette=categoryPalettes[category(label)];return palette[(number-1)%palette.length]}
function trackName(track){
  const base = displayLabel(track.label)
  if(!animalLabels.has(track.label)&&(subjectCounters.get(track.label)||1)<2)return base
  return `${base.charAt(0).toUpperCase()+base.slice(1)} ${track.subjectNumber}`
}
function trackingObjects(objects){ return objects.filter(o => o.score >= .24 && !quietLabels.has(o.label)).slice(0,16) }
function containment(first,second){
  const x1=Math.max(first[0],second[0]),y1=Math.max(first[1],second[1]),x2=Math.min(first[2],second[2]),y2=Math.min(first[3],second[3])
  const intersection=Math.max(0,x2-x1)*Math.max(0,y2-y1)
  return intersection/Math.min(boxArea(first),boxArea(second))
}
function dedupeDetections(objects){
  const kept=[]
  for(const object of [...objects].sort((a,b)=>b.score-a.score)){
    const duplicate=kept.some(item=>item.label===object.label&&(iou(item.box,object.box)>(animalLabels.has(object.label)?.78:.66)||containment(item.box,object.box)>(animalLabels.has(object.label)?.92:.82)))
    if(!duplicate)kept.push(object)
  }
  return kept
}
function trackConfidence(track){
  const stable=Number(track.stableScore??track.score??0),evidence=Math.min(.08,Math.max(0,(track.evidenceFrames||1)-1)*.012),missPenalty=(track.missed||0)*.035
  return Math.max(0,Math.min(.98,stable*.92+evidence-missPenalty))
}
function filtered(objects){ return objects.filter(o => trackConfidence(o)>=.45&&((o.evidenceFrames||1)>=2||trackConfidence(o)>=.68)&&(activeFilter === 'all' || category(o.label) === activeFilter)).slice(0,4) }
function distance(a,b){ const ax=(a.box[0]+a.box[2])/2, ay=(a.box[1]+a.box[3])/2, bx=(b.box[0]+b.box[2])/2, by=(b.box[1]+b.box[3])/2; return Math.hypot(ax-bx,ay-by) }
function iou(a,b){ const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]); const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1); const area=x=>(x[2]-x[0])*(x[3]-x[1]); return inter/(area(a)+area(b)-inter||1) }
function apparentSize(track){ const area=Math.max(0,track.box[2]-track.box[0])*Math.max(0,track.box[3]-track.box[1]); return area<.045?t('small'):area<.18?t('medium'):t('large') }
function boxArea(box){return Math.max(.0001,(box[2]-box[0])*(box[3]-box[1]))}

function appearanceSignature(rgb,box){
  const signature=[],grid=4
  for(let row=0;row<grid;row++)for(let column=0;column<grid;column++){
    const x=Math.max(0,Math.min(639,Math.round((box[0]+(column+.5)/grid*(box[2]-box[0]))*639)))
    const y=Math.max(0,Math.min(639,Math.round((box[1]+(row+.5)/grid*(box[3]-box[1]))*639))),index=(y*640+x)*3
    signature.push(rgb[index],rgb[index+1],rgb[index+2])
  }
  return signature
}

function appearanceDistance(first,second){
  if(!first?.length||first.length!==second?.length)return .5
  return first.reduce((sum,value,index)=>sum+Math.abs(value-second[index]),0)/(first.length*255)
}

function blendAppearance(first,second){return first?.length===second?.length?first.map((value,index)=>value*.72+second[index]*.28):second}
function memoryTtl(label){return animalLabels.has(label)?2*60*60*1000:label==='person'?60*60*1000:30*60*1000}

function reviveTrack(object){
  const now=Date.now();retiredTracks=retiredTracks.filter(track=>now-track.lastSeen<memoryTtl(track.label))
  const candidates=retiredTracks.filter(track=>track.label===object.label)
  let best=null,bestScore=Infinity
  for(const candidate of candidates){
    const visual=appearanceDistance(candidate.appearance,object.appearance),size=Math.abs(Math.log(boxArea(candidate.box)/boxArea(object.box))),age=(now-candidate.lastSeen)/memoryTtl(candidate.label)
    const score=visual+Math.min(size,2)*.08+age*.12
    if(score<bestScore){best=candidate;bestScore=score}
  }
  const threshold=animalLabels.has(object.label)?.62:object.label==='person'?.58:.54
  if(!best||bestScore>threshold)return null
  retiredTracks=retiredTracks.filter(track=>track.id!==best.id)
  return {...best,...object,stableScore:(best.stableScore||best.score||object.score)*.65+object.score*.35,evidenceFrames:(best.evidenceFrames||1)+1,appearance:blendAppearance(best.appearance,object.appearance),missed:0,motion:0,dx:0,dy:0,scaleDelta:0,windowDx:0,windowDy:0,windowScale:0,windowTravel:0,windowStartedAt:now,lastSeen:now}
}

function setHighlightedText(element,textValue,subjects=[]){
  const text=String(textValue||'');element.replaceChildren()
  const tokenMap=new Map()
  for(const subject of subjects){
    const name=subject.name||trackName(subject),generic=displayLabel(subject.label)
    for(const token of [name,generic])if(token&&token.length>2&&!tokenMap.has(token.toLowerCase()))tokenMap.set(token.toLowerCase(),subject.color)
  }
  const tokens=[...tokenMap.keys()].sort((a,b)=>b.length-a.length)
  if(!tokens.length){element.textContent=text;return}
  const escaped=tokens.map(token=>token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
  const pattern=new RegExp(`(${escaped.join('|')})`,'gi')
  for(const part of text.split(pattern)){
    const color=tokenMap.get(part.toLowerCase())
    if(color){const span=document.createElement('span');span.className='entity-word';span.style.color=color;span.textContent=part;element.append(span)}else element.append(document.createTextNode(part))
  }
}

function clearSceneHistory(){
  if(pendingSceneTimer)clearTimeout(pendingSceneTimer)
  for(const item of sceneHistory)if(item.fadeTimer)clearTimeout(item.fadeTimer)
  pendingSceneTimer=null;pendingScene=null;sceneLastAcceptedAt=0;sceneHistory.splice(0);sceneText.replaceChildren();sceneConfidence.textContent=''
}

function renderSceneHistory(){
  sceneHistory.forEach((item,index)=>{item.element.className=`scene-entry scene-age-${index}${index===0&&item.settled?' scene-settled':''}`})
  sceneText.replaceChildren(...sceneHistory.map(item=>item.element))
  sceneConfidence.textContent=sceneHistory[0]?.confidence||''
}

function acceptScene(scene){
  const element=document.createElement('span')
  setHighlightedText(element,scene.text,scene.subjects)
  const item={...scene,element,settled:false,fadeTimer:null}
  sceneHistory.unshift(item)
  for(const removed of sceneHistory.splice(4))if(removed.fadeTimer)clearTimeout(removed.fadeTimer)
  sceneLastAcceptedAt=Date.now();renderSceneHistory();element.classList.add('scene-entering')
  requestAnimationFrame(()=>element.classList.remove('scene-entering'))
  item.fadeTimer=setTimeout(()=>{item.settled=true;renderSceneHistory()},2800)
}

function flushPendingScene(){
  pendingSceneTimer=null
  if(!pendingScene)return
  const scene=pendingScene;pendingScene=null;acceptScene(scene)
}

function setScene(textValue,subjects=[],options={}){
  const text=String(textValue||'').trim()||'—'
  if(options.reset)clearSceneHistory()
  if(text==='—'){if(!sceneHistory.length)sceneText.textContent='—';return}
  if(sceneHistory[0]?.text===text){sceneHistory[0].confidence=options.confidence??sceneHistory[0].confidence;renderSceneHistory();return}
  const scene={text,subjects:[...subjects],confidence:options.confidence||''},wait=Math.max(0,sceneMinimumHoldMs-(Date.now()-sceneLastAcceptedAt))
  if(options.immediate||!sceneHistory.length||wait===0){pendingScene=null;if(pendingSceneTimer)clearTimeout(pendingSceneTimer);pendingSceneTimer=null;acceptScene(scene);return}
  pendingScene=scene
  if(!pendingSceneTimer)pendingSceneTimer=setTimeout(flushPendingScene,wait)
}

function frameSharpness(rgba){
  let total=0,samples=0
  for(let y=12;y<628;y+=16)for(let x=12;x<628;x+=16){const index=(y*640+x)*4,right=index+16*4,down=index+16*640*4;const light=.299*rgba[index]+.587*rgba[index+1]+.114*rgba[index+2],rightLight=.299*rgba[right]+.587*rgba[right+1]+.114*rgba[right+2],downLight=.299*rgba[down]+.587*rgba[down+1]+.114*rgba[down+2];total+=Math.abs(light-rightLight)+Math.abs(light-downLight);samples++}
  return total/Math.max(1,samples)
}

async function initFaceCues(){
  try{
    const {FilesetResolver,FaceLandmarker}=await import('/mediapipe/vision_bundle.mjs'),vision=await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    faceLandmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'/models/face_landmarker.task'},runningMode:'VIDEO',numFaces:2,outputFaceBlendshapes:true,minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55,minTrackingConfidence:.55})
  }catch{faceLandmarker=null}
}

function readableFaceCue(categories){
  const scores=new Map(categories.map(category=>[category.categoryName,Number(category.score)||0])),average=(...names)=>names.reduce((sum,name)=>sum+(scores.get(name)||0),0)/names.length
  const candidates=[
    {code:'smile',score:average('mouthSmileLeft','mouthSmileRight'),en:'smiles visibly',it:'sorride visibilmente'},
    {code:'wide-eyes',score:average('eyeWideLeft','eyeWideRight','browInnerUp'),en:'widens the eyes and raises the eyebrows',it:'spalanca gli occhi e alza le sopracciglia'},
    {code:'mouth-open',score:scores.get('jawOpen')||0,en:'opens the mouth',it:'apre la bocca'},
    {code:'pucker',score:scores.get('mouthPucker')||0,en:'purses the lips',it:'stringe le labbra'},
    {code:'cheek-puff',score:scores.get('cheekPuff')||0,en:'puffs the cheeks',it:'gonfia le guance'},
    {code:'nose-sneer',score:average('noseSneerLeft','noseSneerRight'),en:'wrinkles the nose',it:'arriccia il naso'},
    {code:'blink',score:average('eyeBlinkLeft','eyeBlinkRight'),en:'closes both eyes',it:'chiude entrambi gli occhi'}
  ].filter(cue=>cue.score>.38).sort((first,second)=>second.score-first.score)
  return candidates[0]||null
}

function analyseFaceCues(objects){
  const now=performance.now()
  if(!faceLandmarker||now<nextFaceCueAt||!objects.some(object=>object.label==='person'))return
  nextFaceCueAt=now+500
  try{
    const result=faceLandmarker.detectForVideo(capture,now),cues=(result.faceBlendshapes||[]).map(face=>readableFaceCue(face.categories||[])).filter(Boolean)
    faceCues=cues.slice(0,2).map(cue=>({code:cue.code,text:language==='it'?cue.it:cue.en,score:cue.score,at:Date.now()}))
    const lead=faceCues[0]
    if(lead){const detail=language==='it'?`La persona ${lead.text}`:`The person ${lead.text}`;addEvent(t('facialCue'),`${detail} · ${Math.round(lead.score*100)}%`,`face:${lead.code}`,objects.filter(object=>object.label==='person').slice(0,1),7000)}
  }catch{faceCues=[]}
}

function paddedSquare(box,padding=1.25){
  const width=box[2]-box[0],height=box[3]-box[1],size=Math.min(1,Math.max(width,height)*padding),centerX=(box[0]+box[2])/2,centerY=(box[1]+box[3])/2
  return {x:Math.max(0,Math.min(1-size,centerX-size/2)),y:Math.max(0,Math.min(1-size,centerY-size/2)),size}
}

function poseCuesFor(points,previous=[]){
  const point=index=>points[index]?.score>.28?points[index]:null,nose=point(2),neck=point(3),tail=point(4),paws=[point(7),point(10),point(13),point(16)].filter(Boolean),cues=[]
  if(nose&&neck&&nose.y-neck.y>.07)cues.push({code:'head-lowered',text:language==='it'?'tiene la testa abbassata':'holds the head lowered',score:Math.min(nose.score,neck.score)})
  if(neck&&tail&&paws.length>=3){const bodyY=(neck.y+tail.y)/2,pawGap=paws.reduce((sum,paw)=>sum+paw.y,0)/paws.length-bodyY;if(pawGap<.16)cues.push({code:'body-low',text:language==='it'?'mantiene il corpo vicino al suolo':'keeps the body close to the ground',score:Math.min(neck.score,tail.score,...paws.map(paw=>paw.score))})}
  if(neck&&tail&&Math.abs(tail.x-neck.x)>Math.abs(tail.y-neck.y)*1.4)cues.push({code:'body-horizontal',text:language==='it'?'ha il corpo orientato orizzontalmente':'has the body oriented horizontally',score:Math.min(neck.score,tail.score)})
  const oldTail=previous[4]
  if(tail&&oldTail?.score>.28&&Math.hypot(tail.x-oldTail.x,tail.y-oldTail.y)>.035)cues.push({code:'tail-root-motion',text:language==='it'?'muove la base della coda':'moves the base of the tail',score:Math.min(tail.score,oldTail.score)})
  return cues.sort((first,second)=>second.score-first.score).slice(0,2)
}

async function analyseAnimalPose(objects){
  const now=performance.now(),dogs=objects.filter(object=>object.label==='dog').slice(0,2)
  if(!animalPoseEnabled||!dogs.length||now<nextAnimalPoseAt)return
  nextAnimalPoseAt=now+650
  for(const dog of dogs){
    const crop=paddedSquare(dog.box),previous=dog.poseKeypoints||[]
    poseCropCtx.drawImage(capture,crop.x*640,crop.y*640,crop.size*640,crop.size*640,0,0,256,256)
    const rgba=poseCropCtx.getImageData(0,0,256,256).data,rgb=new Uint8Array(256*256*3)
    for(let source=0,target=0;source<rgba.length;source+=4){rgb[target++]=rgba[source];rgb[target++]=rgba[source+1];rgb[target++]=rgba[source+2]}
    try{
      const response=await fetch('/api/pose',{method:'POST',headers:{'content-type':'application/octet-stream'},body:rgb});if(!response.ok)continue
      const result=await response.json(),localPoints=Array.isArray(result.keypoints)?result.keypoints:[]
      dog.poseCues=poseCuesFor(localPoints,previous.map(point=>point.local||point));dog.poseKeypoints=localPoints.map(point=>({...point,x:crop.x+point.x*crop.size,y:crop.y+point.y*crop.size,local:point}));dog.poseAt=Date.now()
      const cue=dog.poseCues[0]
      if(cue)addEvent(t('animalActivity'),`${trackName(dog)} ${cue.text} · ${Math.round(cue.score*100)}%`,`dog-pose:${dog.id}:${cue.code}`,[dog],7000)
    }catch{}
  }
}

function considerSemanticFrame(rgba,objects){
  const now=Date.now()
  if(!objects.length){if(now-(semanticFrames.at(-1)?.at||0)>2500)semanticFrames.splice(0);return}
  if(now-lastSemanticSampleAt<700)return
  const frame=document.createElement('canvas');frame.width=640;frame.height=640;frame.getContext('2d').drawImage(capture,0,0)
  semanticFrames.push({frame,at:now,sharpness:frameSharpness(rgba)});semanticFrames.splice(0,Math.max(0,semanticFrames.length-4));lastSemanticSampleAt=now
}

function semanticSequenceSource(){
  if(semanticFrames.length<2)return {source:semanticFrames.at(-1)?.frame||capture,count:1}
  semanticContactSheetCtx.fillStyle='#08100b';semanticContactSheetCtx.fillRect(0,0,640,640)
  const frames=semanticFrames.slice(-4)
  frames.forEach((item,index)=>{const x=index%2*320,y=Math.floor(index/2)*320;semanticContactSheetCtx.drawImage(item.frame,x,y,320,320);semanticContactSheetCtx.fillStyle='rgba(4,12,7,.72)';semanticContactSheetCtx.fillRect(x+8,y+8,25,22);semanticContactSheetCtx.fillStyle='#dff5e5';semanticContactSheetCtx.font='600 13px -apple-system,sans-serif';semanticContactSheetCtx.fillText(String(index+1),x+17,y+24)})
  return {source:semanticContactSheet,count:frames.length}
}

function completeSceneSummary(summary,subjects=[]){
  const base=String(summary||'').trim(),lower=base.toLowerCase(),missing=[],genericClaims=new Set()
  for(const subject of subjects.slice(0,4)){
    const name=subject.name||trackName(subject),generic=displayLabel(subject.label)
    if(lower.includes(name.toLowerCase()))continue
    if(subject.label==='person'&&/\b(person|people|man|woman|boy|girl|individual|persona|persone|uomo|donna|ragazzo|ragazza)\b/i.test(lower))continue
    if(subject.label==='dog'&&/\b(dog|dogs|puppy|puppies|cane|cani|cucciolo|cuccioli)\b/i.test(lower))continue
    if(subject.label==='cat'&&/\b(cat|cats|kitten|kittens|gatto|gatti|gattino|gattini)\b/i.test(lower))continue
    if(lower.includes(generic.toLowerCase())&&!genericClaims.has(subject.label)){genericClaims.add(subject.label);continue}
    if(!missing.some(item=>item.name===name))missing.push({name,label:subject.label})
  }
  if(!missing.length)return base
  const names=missing.map(item=>item.name).join(', ')
  const punctuated=/[.!?]$/.test(base)?base:`${base}.`
  return `${punctuated} ${language==='it'?'Visibili anche':'Also visible'}: ${names}.`
}

function predictedBox(track){
  const lead=Math.min(3,1+(track.missed||0)*.55),dx=(track.dx||0)*lead,dy=(track.dy||0)*lead
  return [track.box[0]+dx,track.box[1]+dy,track.box[2]+dx,track.box[3]+dy]
}

function updateTrack(track,object){
  const step=distance(track,object),oldX=(track.box[0]+track.box[2])/2,oldY=(track.box[1]+track.box[3])/2,oldArea=boxArea(track.box)
  const newX=(object.box[0]+object.box[2])/2,newY=(object.box[1]+object.box[3])/2,newArea=boxArea(object.box)
  track.dx=(track.dx||0)*.55+(newX-oldX)*.45;track.dy=(track.dy||0)*.55+(newY-oldY)*.45;track.scaleDelta=(track.scaleDelta||0)*.55+(newArea-oldArea)*.45
  track.windowDx+=newX-oldX;track.windowDy+=newY-oldY;track.windowScale+=newArea-oldArea;track.windowTravel+=step
  track.motion=track.motion*.65+step*.35;track.travel+=step;track.appearance=blendAppearance(track.appearance,object.appearance);track.box=track.box.map((value,index)=>value*.52+object.box[index]*.48);track.stableScore=(track.stableScore??track.score)*.76+object.score*.24;track.score=object.score;track.evidenceFrames=(track.evidenceFrames||1)+1;track.missed=0;track.lastSeen=Date.now()
}

function updateTracks(objects){
  const unmatchedTracks=new Set(tracks.map((_,index)=>index)),unmatchedObjects=new Set(objects.map((_,index)=>index))
  const matchPass=(minimumDetection,strongPass)=>{
    const pairs=[]
    for(const trackIndex of unmatchedTracks)for(const objectIndex of unmatchedObjects){
      const track=tracks[trackIndex],object=objects[objectIndex]
      if(object.label!==track.label||strongPass!==(object.score>=.48)||object.score<minimumDetection)continue
      const predicted={box:predictedBox(track)},visual=appearanceDistance(track.appearance,object.appearance),spatial=distance(predicted,object),overlap=iou(predicted.box,object.box)
      pairs.push({trackIndex,objectIndex,score:overlap-spatial*.48-visual*.22,visual})
    }
    pairs.sort((first,second)=>second.score-first.score)
    for(const pair of pairs){
      if(!unmatchedTracks.has(pair.trackIndex)||!unmatchedObjects.has(pair.objectIndex))continue
      const accepted=strongPass?pair.score>-.2||pair.visual<.25:pair.score>-.08||pair.visual<.18
      if(!accepted)continue
      updateTrack(tracks[pair.trackIndex],objects[pair.objectIndex]);unmatchedTracks.delete(pair.trackIndex);unmatchedObjects.delete(pair.objectIndex)
    }
  }
  matchPass(.48,true);matchPass(.24,false)
  for(const trackIndex of unmatchedTracks)tracks[trackIndex].missed++
  for(const track of tracks.filter(track=>track.missed>=35)){if(!retiredTracks.some(memory=>memory.id===track.id))retiredTracks.push({...track,retiredAt:Date.now()})}
  retiredTracks=retiredTracks.slice(-30);tracks=tracks.filter(track=>track.missed<35)
  for(const index of unmatchedObjects){
    const object=objects[index]
    if(object.score<.48)continue
    const revived=reviveTrack(object)
    if(revived){tracks.push(revived);continue}
    const next=(subjectCounters.get(object.label)||0)+1;subjectCounters.set(object.label,next)
    const group=category(object.label),colorNumber=(categoryColorCounters.get(group)||0)+1;categoryColorCounters.set(group,colorNumber)
    tracks.push({...object,id:nextTrackId++,subjectNumber:next,color:subjectColor(object.label,colorNumber),stableScore:object.score,evidenceFrames:1,missed:0,motion:0,dx:0,dy:0,scaleDelta:0,travel:0,windowDx:0,windowDy:0,windowScale:0,windowTravel:0,windowStartedAt:Date.now(),firstSeen:Date.now(),lastSeen:Date.now()})
  }
  return tracks.filter(track=>track.missed===0)
}

function addEvent(title, detail, stableKey=`${title}:${detail}`, subjects=[], ttlOverride=null){
  const now=Date.now(), ttl=ttlOverride??(stableKey.startsWith('temporal:')?5000:stableKey.startsWith('movement:')?4200:stableKey.startsWith('semantic:')?9000:30000)
  if(now-(eventLastSeen.get(stableKey)||0)<ttl) return
  eventLastSeen.set(stableKey,now)
  events.unshift({title,detail,stableKey,subjects,at:new Date()}); events.splice(5)
  renderEvents()
}

function movementText(track,key){
  if(language!=='it'||track.label!=='person')return t(key)
  return {movedLeft:'si è spostata a sinistra',movedRight:'si è spostata a destra',movedUp:'si è spostata verso l’alto',movedDown:'si è spostata verso il basso',closer:'si è avvicinata alla fotocamera',farther:'si è allontanata dalla fotocamera',shifted:'ha cambiato leggermente posizione'}[key]||t(key)
}

function motionNarrative(track){
  const parts=[],codes=[]
  if(Math.abs(track.dx)>Math.abs(track.dy)&&Math.abs(track.dx)>.006){parts.push(movementText(track,track.dx>0?'movedRight':'movedLeft'));codes.push(track.dx>0?'right':'left')}
  else if(Math.abs(track.dy)>.006){parts.push(movementText(track,track.dy>0?'movedDown':'movedUp'));codes.push(track.dy>0?'down':'up')}
  if(Math.abs(track.scaleDelta)>.008){parts.push(movementText(track,track.scaleDelta>0?'closer':'farther'));codes.push(track.scaleDelta>0?'closer':'farther')}
  return {text:parts.join(language==='it'?' e ':' and ')||movementText(track,'shifted'),code:codes.join('-')||'shifted'}
}

function localSceneNarrative(track){
  const name=trackName(track),motion=motionNarrative(track).text
  if(language==='it'){
    const subject=name==='persona'?'La persona':name==='cane'?'Il cane':name==='gatto'?'Il gatto':name.charAt(0).toUpperCase()+name.slice(1)
    return `${subject} ${motion}.`
  }
  const subject=name==='person'?'The person':name==='dog'?'The dog':name==='cat'?'The cat':name.charAt(0).toUpperCase()+name.slice(1)
  return `${subject} ${motion}.`
}

function temporalNarrative(track){
  const parts=[]
  if(Math.abs(track.windowDx)>Math.abs(track.windowDy)&&Math.abs(track.windowDx)>.018)parts.push(movementText(track,track.windowDx>0?'movedRight':'movedLeft'))
  else if(Math.abs(track.windowDy)>.018)parts.push(movementText(track,track.windowDy>0?'movedDown':'movedUp'))
  if(Math.abs(track.windowScale)>.014)parts.push(movementText(track,track.windowScale>0?'closer':'farther'))
  return parts.join(language==='it'?' e ':' and ')||movementText(track,'shifted')
}

function sceneTempo(objects){
  const people=objects.filter(object=>object.label==='person'),animals=objects.filter(object=>animalLabels.has(object.label))
  const pairs=[]
  for(let index=0;index<objects.length;index++)for(let other=index+1;other<objects.length;other++)pairs.push([objects[index],objects[other]])
  const closeInteraction=pairs.some(([a,b])=>distance(a,b)<.3&&((animalLabels.has(a.label)&&animalLabels.has(b.label))||(a.label==='person'&&animalLabels.has(b.label))||(b.label==='person'&&animalLabels.has(a.label))))
  const moving=objects.filter(object=>object.motion>.014),fastAnimal=animals.some(animal=>animal.motion>.022)
  const highActivity=closeInteraction||fastAnimal||moving.length>=2
  if(highActivity)return {windowMs:1500,eventGapMs:2400,semanticGapMs:3200,mode:'active'}
  if(objects.length>=2&&moving.length)return {windowMs:1800,eventGapMs:3200,semanticGapMs:4200,mode:'mixed'}
  return {windowMs:2200,eventGapMs:4400,semanticGapMs:6200,mode:'calm'}
}

function recordTemporalWindows(objects){
  const now=Date.now(),tempo=sceneTempo(objects)
  for(const track of objects.slice(0,3)){
    if(now-track.windowStartedAt<tempo.windowMs)continue
    const kind=category(track.label),minTravel=kind==='animal'?.04:kind==='person'?.065:.05,minScale=kind==='animal'?.016:kind==='person'?.024:.02
    const meaningful=track.windowTravel>minTravel||Math.abs(track.windowScale)>minScale
    const confidence=trackConfidence(track)
    if(meaningful&&confidence>.6){const narrative=temporalNarrative(track);track.lastMotionText=narrative;track.lastMotionAt=now;const detail=`${narrative} · ${Math.round(confidence*100)}%`;addEvent(`${trackName(track)} · ${t('windowActivity')}`,detail,`temporal:${track.id}`,[track],tempo.eventGapMs)}
    track.windowDx=0;track.windowDy=0;track.windowScale=0;track.windowTravel=0;track.windowStartedAt=now
  }
}

function recordDogToyRelations(objects){
  const dogs=objects.filter(object=>object.label==='dog'),items=objects.filter(object=>dogInterestLabels.has(object.label))
  for(const dog of dogs)for(const item of items){
    if(distance(dog,item)<.26&&dog.motion+item.motion>.018){
      const food=foodLabels.has(item.label),title=language==='it'?(food?'Interesse per cibo':'Interazione con gioco'):(food?'Food interest':'Toy interaction')
      const detail=language==='it'?`${trackName(dog)} si muove vicino a ${trackName(item)}`:`${trackName(dog)} moves near ${trackName(item)}`
      addEvent(title,detail,`dog-interest:${dog.id}:${item.id}`,[dog,item],10000)
    }
  }
}

function removeSupersededMotionEvents(subjects){
  const ids=new Set(subjects.map(subject=>subject.id).filter(Boolean)),cutoff=Date.now()-15000
  for(let index=events.length-1;index>=0;index--){const event=events[index];if(event.at.getTime()>=cutoff&&event.stableKey?.startsWith('temporal:')&&event.subjects.some(subject=>ids.has(subject.id)))events.splice(index,1)}
  renderEvents()
}

function semanticTitle(item){
  if(item.kind==='interaction')return t('interaction')
  if(item.kind==='dog'||item.kind==='animal')return t('animalActivity')
  if(item.kind==='human'&&/face|facial|expression|mouth|smil|brow|eye|viso|espression|bocca|sorris|sopraccigl|occhi/i.test(item.summary||''))return t('facialCue')
  return t('visualDetail')
}

function fuseLatestMotion(item){
  if(item.motionFused)return item
  const recent=tracks.filter(track=>track.missed===0&&track.lastMotionText&&Date.now()-track.lastMotionAt<6500&&!(item.dogVerified===false&&track.label==='dog')).sort((a,b)=>b.lastMotionAt-a.lastMotionAt)[0]
  if(!recent)return item
  const rawName=trackName(recent),subject=language==='it'?(rawName==='persona'?'la persona':rawName):(rawName==='person'?'the person':rawName)
  const summary=String(item.summary||'').replace(/[.!?]+$/,'')
  return {...item,summary:`${summary}${language==='it'?', mentre ':' while '}${subject} ${recent.lastMotionText}.`,motionFused:true}
}

function renderEvents(){
  timeline.replaceChildren(...events.map(event=>{ const el=document.createElement('div'); el.className='event'; el.innerHTML='<time></time><div class="event-copy"><strong></strong><span></span></div>'; el.title=`${event.title} — ${event.detail}`;el.querySelector('time').textContent=event.at.toLocaleTimeString(language==='it'?'it-IT':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); setHighlightedText(el.querySelector('strong'),event.title,event.subjects);setHighlightedText(el.querySelector('.event-copy>span'),event.detail,event.subjects); return el }))
}

function draw(objects){
  const rect=overlay.getBoundingClientRect(), ratio=window.devicePixelRatio||1
  if(overlay.width!==Math.round(rect.width*ratio)||overlay.height!==Math.round(rect.height*ratio)){overlay.width=Math.round(rect.width*ratio);overlay.height=Math.round(rect.height*ratio)}
  overlayCtx.setTransform(ratio,0,0,ratio,0,0); overlayCtx.clearRect(0,0,rect.width,rect.height)
  if(!overlayToggle.checked) return
  const sourceRatio=(video.videoWidth||16)/(video.videoHeight||9), targetRatio=rect.width/rect.height
  let shownW=rect.width,shownH=rect.height,offsetX=0,offsetY=0
  if(sourceRatio>targetRatio){shownW=rect.height*sourceRatio;offsetX=(rect.width-shownW)/2}else{shownH=rect.width/sourceRatio;offsetY=(rect.height-shownH)/2}
  overlayCtx.font='600 12px -apple-system, sans-serif'; overlayCtx.lineWidth=1.5
  const poseConnections=[[0,2],[1,2],[2,3],[3,4],[3,5],[5,6],[6,7],[3,8],[8,9],[9,10],[4,11],[11,12],[12,13],[4,14],[14,15],[15,16]]
  for(const object of objects){
    const [x1,y1,x2,y2]=object.box, x=offsetX+x1*shownW, y=offsetY+y1*shownH, w=(x2-x1)*shownW, h=(y2-y1)*shownH
    const text=`${trackName(object)} - ${Math.round(trackConfidence(object)*100)}%`, textW=overlayCtx.measureText(text).width+12
    overlayCtx.strokeStyle=object.color; overlayCtx.strokeRect(x,y,w,h)
    overlayCtx.fillStyle='rgba(7,17,11,.78)'; overlayCtx.fillRect(x,Math.max(0,y-22),textW,21)
    overlayCtx.fillStyle=object.color; overlayCtx.fillText(text,x+6,Math.max(14,y-7))
    if(object.label==='dog'&&Date.now()-(object.poseAt||0)<1800&&object.poseKeypoints?.length){
      overlayCtx.save();overlayCtx.globalAlpha=.62;overlayCtx.strokeStyle=object.color;overlayCtx.fillStyle=object.color;overlayCtx.lineWidth=1
      for(const [first,second] of poseConnections){const a=object.poseKeypoints[first],b=object.poseKeypoints[second];if(a?.score>.3&&b?.score>.3){overlayCtx.beginPath();overlayCtx.moveTo(offsetX+a.x*shownW,offsetY+a.y*shownH);overlayCtx.lineTo(offsetX+b.x*shownW,offsetY+b.y*shownH);overlayCtx.stroke()}}
      for(const point of object.poseKeypoints)if(point.score>.34){overlayCtx.beginPath();overlayCtx.arc(offsetX+point.x*shownW,offsetY+point.y*shownH,1.6,0,Math.PI*2);overlayCtx.fill()}
      overlayCtx.restore()
    }
  }
}

function summarize(objects){
  const chips=objects.map(object=>{const item=document.createElement('span');item.textContent=`${trackName(object)} - ${Math.round(trackConfidence(object)*100)}%`;item.style.color=object.color;item.style.borderColor=`${object.color}66`;return item})
  detectedList.replaceChildren(...(chips.length?chips:[Object.assign(document.createElement('span'),{textContent:t('none')})]))
  if(Date.now()-lastInterpretationAt<6000) return
  if(!objects.length){setScene(t('empty'));return}
  const dogs=objects.filter(o=>o.label==='dog')
  if(dogs.length>=2 && distance(dogs[0],dogs[1])<.24 && dogs[0].motion+dogs[1].motion>.022){
    const description=language==='it'?`${trackName(dogs[0])} e ${trackName(dogs[1])} si muovono vicini.`:`${trackName(dogs[0])} and ${trackName(dogs[1])} are moving close together.`
    setScene(description,dogs);addEvent(t('together'),t('togetherDetail'),'dogs:together',dogs);return
  }
  const lead=[...objects].sort((a,b)=>b.motion-a.motion)[0],moving=lead.motion>.014
  setScene(moving?localSceneNarrative(lead):'—',moving?[lead]:[])
  const confidence=trackConfidence(lead)
  if(confidence>.65&&Date.now()-lead.firstSeen<1600)addEvent(t('appeared'),`${trackName(lead)} - ${Math.round(confidence*100)}%`,`detected:${lead.id}`,[lead])
}

async function analyse(){
  if(!running||busy||video.readyState<2)return
  busy=true;const started=performance.now()
  try{
    captureCtx.drawImage(video,0,0,640,640)
    const rgba=captureCtx.getImageData(0,0,640,640).data,rgb=new Uint8Array(640*640*3)
    for(let source=0,target=0;source<rgba.length;source+=4){rgb[target++]=rgba[source];rgb[target++]=rgba[source+1];rgb[target++]=rgba[source+2]}
    const response=await fetch('/api/detect',{method:'POST',headers:{'content-type':'application/octet-stream'},body:rgb})
    if(!response.ok)throw new Error((await response.json()).error||`detector ${response.status}`)
    const payload=await response.json(),candidates=dedupeDetections(trackingObjects(payload.objects||[])).map(object=>({...object,appearance:appearanceSignature(rgb,object.box)})),allCurrent=updateTracks(candidates),current=filtered(allCurrent)
    recordTemporalWindows(allCurrent)
    recordDogToyRelations(allCurrent)
    considerSemanticFrame(rgba,current)
    analyseFaceCues(allCurrent)
    await analyseAnimalPose(allCurrent)
    const now=Date.now(),recentFaceCues=faceCues.filter(cue=>now-cue.at<4000),trackedFacts=current.map((object,index)=>({id:object.id,label:object.label,name:trackName(object),color:object.color,score:trackConfidence(object),rawScore:object.score,frames:object.evidenceFrames||1,motion:object.motion,motionText:now-(object.lastMotionAt||0)<6500?object.lastMotionText:null,size:apparentSize(object),faceCues:object.label==='person'&&index===current.findIndex(item=>item.label==='person')?recentFaceCues:[],poseCues:object.label==='dog'&&now-(object.poseAt||0)<2500?(object.poseCues||[]):[]}))
    const dogVisible=allCurrent.some(object=>object.label==='dog'),trackedLabels=new Set(trackedFacts.map(fact=>fact.label)),contextFacts=dogVisible?(payload.objects||[]).filter(object=>(environmentLabels.has(object.label)||dogInterestLabels.has(object.label))&&!trackedLabels.has(object.label)&&object.score>.36).slice(0,4).map(object=>({label:object.label,name:displayLabel(object.label),score:object.score,context:true,interest:dogInterestLabels.has(object.label)})):[]
    lastFacts=[...trackedFacts,...contextFacts]
    draw(current);summarize(current)
    const elapsed=performance.now()-started;fpsLabel.textContent=`${(1000/Math.max(1,elapsed)).toFixed(1)} AI fps`
    if(visionpsyEnabled&&!interpreting&&Date.now()>=nextInterpretAt){nextInterpretAt=Date.now()+sceneTempo(allCurrent).semanticGapMs;interpret()}
  }catch(error){statusDot.className='error';statusText.textContent=String(error.message||error).slice(0,70)}finally{busy=false}
}

async function interpret(){
  if(interpreting)return
  interpreting=true
  const sequence=semanticSequenceSource(),blob=await new Promise(resolve=>sequence.source.toBlob(resolve,'image/jpeg',.84));if(!blob){interpreting=false;return}
  try{const response=await fetch('/api/interpret',{method:'POST',headers:{'content-type':'image/jpeg','x-vision-facts':JSON.stringify(lastFacts),'x-language':language,'x-frame-count':String(sequence.count)},body:blob});if(!response.ok)return;const item=fuseLatestMotion(await response.json()),semanticFacts=item.dogVerified===false?lastFacts.filter(fact=>fact.label!=='dog'&&!fact.context):lastFacts,completeSummary=completeSceneSummary(item.summary||t('empty'),semanticFacts),confidence=`${Math.round(Number(item.confidence||0)*100)}%`;lastInterpretationAt=Date.now();setScene(completeSummary,semanticFacts,{confidence});if(item.motionFused)removeSupersededMotionEvents(semanticFacts);addEvent(semanticTitle(item),`${item.summary} · ${confidence}`,`semantic:${item.kind||'visual'}`,semanticFacts)}catch{}finally{interpreting=false;nextInterpretAt=Math.max(nextInterpretAt,Date.now()+1500)}
}

function resetSession(){tracks=[];retiredTracks=[];nextTrackId=1;subjectCounters.clear();categoryColorCounters.clear();events.length=0;eventLastSeen.clear();timeline.replaceChildren();lastInterpretationAt=0;semanticFrames.splice(0);lastSemanticSampleAt=0;faceCues=[];nextFaceCueAt=0;nextAnimalPoseAt=0;clearSceneHistory();sceneText.textContent='—'}
async function startLoop(){running=true;emptyState.style.display='none';if(!timer)timer=setInterval(analyse,260)}
async function startCamera(){
  try{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});video.src='';video.srcObject=stream;await video.play();resetSession();startLoop()}
  catch(error){statusDot.className='error';statusText.textContent=t('cameraError');setScene(String(error.message||error),[],{reset:true,immediate:true})}
}
async function openVideo(file){
  if(!file)return
  if(video.srcObject){video.srcObject.getTracks().forEach(track=>track.stop());video.srcObject=null}
  if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.loop=true;await video.play();resetSession();startLoop()
}
function applyLanguage(){
  const changed=language!==languageSelect.value
  language=languageSelect.value;document.documentElement.lang=language
  if(changed){events.length=0;eventLastSeen.clear();lastInterpretationAt=0;clearSceneHistory()}
  document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)})
  if(!running){setScene(t('waiting'),[],{reset:true,immediate:true});detectedList.replaceChildren(Object.assign(document.createElement('span'),{textContent:'—'}))}
  else summarize(tracks.filter(track=>track.missed===0))
  renderEvents();refreshStatus()
}
async function refreshStatus(){
  try{const status=await fetch('/api/status').then(response=>response.json());visionpsyEnabled=status.visionpsy.enabled;animalPoseEnabled=Boolean(status.animalPose?.enabled);if(status.detector.ready){statusDot.className='ready';statusText.textContent=visionpsyEnabled?t('qvacPsy'):t('qvacVision')}else{statusDot.className='error';statusText.textContent=status.detector.reason||'Detector unavailable'}}catch{statusDot.className='error';statusText.textContent='Engine unavailable'}
}

document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));activeFilter=button.dataset.filter}))
startButton.addEventListener('click',startCamera)
fileButton.addEventListener('click',()=>videoFile.click())
videoFile.addEventListener('change',()=>openVideo(videoFile.files[0]))
languageSelect.addEventListener('change',applyLanguage)
overlayToggle.addEventListener('change',()=>draw(tracks.filter(track=>track.missed===0)))
window.addEventListener('resize',()=>draw(tracks.filter(track=>track.missed===0)))
applyLanguage();refreshStatus();initFaceCues()
