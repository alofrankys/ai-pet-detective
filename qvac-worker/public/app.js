import {
  NarrativeEngineV2,
  SessionDebugRecorder,
  estimateCameraMotion,
  compensateMotion,
  summaryPayload
} from './narrative-engine-v2.js'
import {
  PersistentIdentityManager,
  BackgroundMotionEstimator,
  PersistentSurfaceMap,
  TemporalPostureClassifier,
  DeepVideoDebugRecorder,
  appearanceDescriptor,
  generateCandidateIntervals,
  reconcileV3Events
} from './deep-video-v3.js'

const video = document.getElementById('camera')
const capture = document.getElementById('capture')
const overlay = document.getElementById('overlay')
const startButton = document.getElementById('startButton')
const fileButton = document.getElementById('fileButton')
const youtubeButton = document.getElementById('youtubeButton')
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
const sessionSummaryButton = document.getElementById('sessionSummaryButton')
const sessionModal = document.getElementById('sessionModal')
const sessionSummaryText = document.getElementById('sessionSummaryText')
const sessionSummaryFacts = document.getElementById('sessionSummaryFacts')
const closeSessionModal = document.getElementById('closeSessionModal')
const exportDebugButton = document.getElementById('exportDebugButton')
const sourceBadge = document.getElementById('sourceBadge')
const youtubeModal = document.getElementById('youtubeModal')
const youtubeForm = document.getElementById('youtubeForm')
const youtubeInput = document.getElementById('youtubeInput')
const youtubeSubmit = document.getElementById('youtubeSubmit')
const youtubeError = document.getElementById('youtubeError')
const closeYoutubeModal = document.getElementById('closeYoutubeModal')
const deepProgress = document.getElementById('deepProgress')
const deepPhase = document.getElementById('deepPhase')
const deepPercent = document.getElementById('deepPercent')
const deepProgressBar = document.getElementById('deepProgressBar')
const deepDetail = document.getElementById('deepDetail')
const narrativeVersion = document.getElementById('narrativeVersion')
const captureCtx = capture.getContext('2d', { willReadFrequently:true })
const overlayCtx = overlay.getContext('2d')
const poseCrop = document.createElement('canvas')
poseCrop.width=256;poseCrop.height=256
const poseCropCtx = poseCrop.getContext('2d',{willReadFrequently:true})
const semanticContactSheet = document.createElement('canvas')
semanticContactSheet.width=960;semanticContactSheet.height=640
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
  en:{language:'Language',labels:'Labels',heroTitle:'Make the scene readable.',heroCopy:'Use the camera, a file or a YouTube URL.',startCamera:'Start camera',openVideo:'Open video',youtubeUrl:'YouTube URL',youtubeTitle:'Analyse a YouTube video',youtubeCopy:'Paste the URL of a public video. It will use the same analysis as camera and uploaded files.',analyseUrl:'Analyse URL',preparingYoutube:'Preparing YouTube video…',invalidYoutube:'Enter a valid public YouTube video URL.',cameraSource:'Live camera',fileSource:'Uploaded video',youtubeSource:'YouTube',all:'All',people:'People',animals:'Animals',objects:'Objects',scene:'SCENE',detected:'DETECTED',recentEvents:'RECENT EVENTS',waiting:'Waiting for a source',none:'Nothing detected',empty:'No clear subject in the foreground',shared:'share the scene',moving:'moving',still:'still',small:'small',medium:'medium',large:'large',appeared:'Detected',movement:'Movement',windowActivity:'Activity',together:'Moving together',togetherDetail:'Two dogs are close and moving',facialCue:'Facial gesture',animalActivity:'Animal activity',interaction:'Interaction',standing:'Standing',sitting:'Sitting',lying:'Lying down',sleeping:'Sleeping',jumping:'Jumping',approaching:'Approaching',leaving:'Moving away',following:'Following',petting:'Petting',feeding:'Feeding',running:'Running',walking:'Walking',playing:'Play',chasing:'Chasing',sniffing:'Sniffing',licking:'Licking',biting:'Mouth contact',chewing:'Chewing',eating:'Eating',drinking:'Drinking',carrying:'Carrying',holding:'Holding',picking_up:'Picking up',putting_down:'Putting down',throwing:'Throwing',offering:'Offering',using_object:'Using an object',reaching:'Reaching',pointing:'Pointing',waving:'Waving',touching:'Touching',hugging:'Hugging',tail_wagging:'Tail movement',urinating:'Urination',defecating:'Defecation',resting:'Resting',visualDetail:'Visual detail',movedLeft:'moved left',movedRight:'moved right',movedUp:'moved upward',movedDown:'moved downward',closer:'came closer to the camera',farther:'moved farther from the camera',shifted:'changed position slightly',cameraError:'Camera unavailable',engine:'Starting engine…',qvacVision:'QVAC detector · semantic engine starting',qvacPsy:'Local QVAC + VisionPsy'},
  it:{language:'Lingua',labels:'Etichette',heroTitle:'La scena, resa leggibile.',heroCopy:'Usa la fotocamera, un file o un URL YouTube.',startCamera:'Avvia fotocamera',openVideo:'Apri video',youtubeUrl:'URL YouTube',youtubeTitle:'Analizza un video YouTube',youtubeCopy:'Incolla l’URL di un video pubblico. Userà la stessa analisi di fotocamera e file caricati.',analyseUrl:'Analizza URL',preparingYoutube:'Preparazione del video YouTube…',invalidYoutube:'Inserisci l’URL valido di un video YouTube pubblico.',cameraSource:'Fotocamera live',fileSource:'Video caricato',youtubeSource:'YouTube',all:'Tutto',people:'Persone',animals:'Animali',objects:'Oggetti',scene:'SCENA',detected:'RILEVATO',recentEvents:'EVENTI RECENTI',waiting:'In attesa di una sorgente',none:'Nessun elemento',empty:'Nessun soggetto in primo piano',shared:'condividono la scena',moving:'in movimento',still:'fermo',small:'piccolo',medium:'medio',large:'grande',appeared:'Rilevato',movement:'Movimento',windowActivity:'Attività',together:'Movimento insieme',togetherDetail:'Due cani sono vicini e in movimento',facialCue:'Gesto del viso',animalActivity:'Attività animale',interaction:'Interazione',standing:'In piedi',sitting:'Seduto',lying:'Sdraiato',sleeping:'Sonno',jumping:'Salto',approaching:'Avvicinamento',leaving:'Allontanamento',following:'Segue',petting:'Carezza',feeding:'Dà da mangiare',running:'Corsa',walking:'Camminata',playing:'Gioco',chasing:'Inseguimento',sniffing:'Annusamento',licking:'Leccata',biting:'Contatto con la bocca',chewing:'Masticazione',eating:'Mangia',drinking:'Beve',carrying:'Trasporta',holding:'Tiene in mano',picking_up:'Raccoglie',putting_down:'Posa',throwing:'Lancia',offering:'Porge',using_object:'Usa un oggetto',reaching:'Allunga la mano',pointing:'Indica',waving:'Saluta',touching:'Tocca',hugging:'Abbraccio',tail_wagging:'Movimento della coda',urinating:'Minzione',defecating:'Defecazione',resting:'Riposo',visualDetail:'Dettaglio visivo',movedLeft:'si è spostato a sinistra',movedRight:'si è spostato a destra',movedUp:'si è spostato verso l’alto',movedDown:'si è spostato verso il basso',closer:'si è avvicinato alla fotocamera',farther:'si è allontanato dalla fotocamera',shifted:'ha cambiato leggermente posizione',cameraError:'Fotocamera non disponibile',engine:'Avvio del motore…',qvacVision:'Detector QVAC · motore semantico in avvio',qvacPsy:'QVAC + VisionPsy locali'}
}
Object.assign(copy.en,{rawObservations:'raw observations',behaviourEvents:'behaviour events',exportDebug:'Export debug JSON',finalising:'Reviewing the full video…',crouching:'Crouching',sitting_down:'Sitting down',standing_up:'Standing up',lying_down:'Lying down',rolling:'Rolling',rubbing:'Rubbing',shaking:'Shaking',stretching:'Stretching',scratching:'Scratching',mouth_open:'Mouth open',tongue_visible:'Tongue visible',head_tilt:'Head tilt',jumping_on:'Jumping on',jumping_off:'Jumping off',entering:'Entering',crossing:'Crossing',dropping:'Dropping',tugging:'Tugging',fetching:'Fetching',mouth_contact:'Mouth contact',dog_dog_interaction:'Dog interaction',person_dog_interaction:'Person–dog interaction',scene_change:'Scene change'})
Object.assign(copy.it,{rawObservations:'osservazioni grezze',behaviourEvents:'eventi comportamentali',exportDebug:'Esporta debug JSON',finalising:'Revisione dell’intero video…',crouching:'Accovacciato',sitting_down:'Si siede',standing_up:'Si alza',lying_down:'Si sdraia',rolling:'Si rotola',rubbing:'Si strofina',shaking:'Si scuote',stretching:'Si allunga',scratching:'Si gratta',mouth_open:'Bocca aperta',tongue_visible:'Lingua visibile',head_tilt:'Testa inclinata',jumping_on:'Sale con un salto',jumping_off:'Scende con un salto',entering:'Entra',crossing:'Attraversa',dropping:'Lascia cadere',tugging:'Gioco di trazione',fetching:'Riporto',mouth_contact:'Contatto con la bocca',dog_dog_interaction:'Interazione tra cani',person_dog_interaction:'Interazione persona–cane',scene_change:'Cambio scena'})
Object.assign(copy.en,{deepPassA:'Deep analysis · perception',deepPassB:'Deep analysis · temporal candidates',deepPassC:'Deep analysis · semantic review',deepPassD:'Deep analysis · global reconciliation',deepPreparing:'Preparing the recorded video…',deepComplete:'Deep recorded analysis complete',deepFailed:'Deep analysis failed'})
Object.assign(copy.it,{deepPassA:'Analisi profonda · percezione',deepPassB:'Analisi profonda · candidati temporali',deepPassC:'Analisi profonda · revisione semantica',deepPassD:'Analisi profonda · riconciliazione globale',deepPreparing:'Preparazione del video registrato…',deepComplete:'Analisi profonda del video completata',deepFailed:'Analisi profonda non riuscita'})

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
let currentSource = null
const events = []
const sessionEvents = []
const sessionContext = new Set()
const sessionMaxVisible = new Map()
const eventLastSeen = new Map()
const sceneHistory = []
const sceneMinimumHoldMs = 2800
let sceneLastAcceptedAt = 0
let pendingScene = null
let pendingSceneTimer = null
let faceLandmarker = null
let nextFaceCueAt = 0
let faceCues = []
let handLandmarker = null
let nextHandCueAt = 0
let handCues = []
const handDogContact = new Map()
let animalPoseEnabled = false
let nextAnimalPoseAt = 0
let debugRecorder = new SessionDebugRecorder()
let narrativeEngine = new NarrativeEngineV2({debugRecorder})
let lastRawDebugAt = 0
let lastCameraMotion = {dx:0,dy:0,scale:0,confidence:0}
let pendingSemanticTrigger = null
let finalizingSession = false
let lastFinalResult = null
let sessionStartedAt = performance.now()
const referenceDetections = new Map()
const contextHypotheses = new Map()
const objectHypotheses = new Map()
const objectRelations = new Map()
const coverageFrames = []
let deepDebugRecorder = null
let deepAnalysisToken = 0
let deepAnalysisComplete = false
let deepFinalResult = null

function t(key){ return copy[language][key] || copy.en[key] || key }

function currentVideoSeconds(){
  return Number.isFinite(video.currentTime)?Number(video.currentTime.toFixed(3)):Math.max(0,(performance.now()-sessionStartedAt)/1000)
}

function currentSessionDuration(){
  return Number.isFinite(video.duration)&&video.duration>0?video.duration:currentVideoSeconds()
}

function resetNarrativeV2(){
  sessionStartedAt=performance.now();lastRawDebugAt=0;lastCameraMotion={dx:0,dy:0,scale:0,confidence:0};pendingSemanticTrigger=null;finalizingSession=false
  referenceDetections.clear();contextHypotheses.clear();objectHypotheses.clear();objectRelations.clear();coverageFrames.splice(0)
  debugRecorder=new SessionDebugRecorder({sessionId:`session_${Date.now()}`,source:currentSource})
  narrativeEngine=new NarrativeEngineV2({sessionId:debugRecorder.sessionId,source:currentSource,debugRecorder,maxStoryEvents:8})
}

function addV2Event(input,{show=true}={}){
  const event=narrativeEngine.addEvent({...input,start:Number(input.start??currentVideoSeconds()),end:Number(input.end??input.start??currentVideoSeconds())})
  if(show&&event.description)addEvent(semanticActionTitle(event.action),`${event.description} · ${Math.round(event.confidence*100)}%`,`v2:${event.id}`,[],1500)
  sessionSummaryButton.hidden=false
  return event
}

function queueSemanticTrigger(type,priority=.7,meta={}){
  const candidate={type,priority,meta,at:currentVideoSeconds(),readyAt:Date.now()+500}
  if(!pendingSemanticTrigger||priority>pendingSemanticTrigger.priority)pendingSemanticTrigger=candidate
  nextInterpretAt=Math.min(nextInterpretAt||Infinity,candidate.readyAt)
}

function updateCameraMotion(objects=[]){
  const stableLabels=new Set(['chair','couch','bed','dining table','potted plant','bench','tv','refrigerator','sink'])
  const now=Date.now(),motions=[]
  const grouped=new Map()
  for(const item of objects.filter(item=>stableLabels.has(item.label)&&item.score>.32)){
    if(!grouped.has(item.label))grouped.set(item.label,[]);grouped.get(item.label).push(item)
  }
  for(const [label,items] of grouped)for(const [index,item] of items.sort((a,b)=>a.box[0]-b.box[0]).slice(0,2).entries()){
    const key=`${label}:${index}`,center={x:(item.box[0]+item.box[2])/2,y:(item.box[1]+item.box[3])/2,scale:boxArea(item.box)},previous=referenceDetections.get(key)
    if(previous&&now-previous.at<1800)motions.push({dx:center.x-previous.x,dy:center.y-previous.y,scale:center.scale-previous.scale,confidence:item.score})
    referenceDetections.set(key,{...center,at:now})
  }
  for(const [key,item] of referenceDetections)if(now-item.at>2500)referenceDetections.delete(key)
  lastCameraMotion=estimateCameraMotion(motions)
  return lastCameraMotion
}

function contextKey(type,value){return `${type}:${value}`}
function rememberContext(type,value,confidence=.6,source='vision'){
  if(!value||value==='unknown')return
  const key=contextKey(type,value),previous=contextHypotheses.get(key)||{type,value,confidence:0,count:0}
  const next={...previous,confidence:Math.max(previous.confidence,Number(confidence)||0),count:previous.count+1,lastAt:currentVideoSeconds(),source}
  contextHypotheses.set(key,next);debugRecorder.addContext(next)
}

function observeContextHypotheses(value,confidence=.65){
  const text=typeof value==='string'?value.toLowerCase():JSON.stringify(value||{}).toLowerCase()
  if(/\b(indoor|indoors|interno|stanza|room|home|casa)\b/.test(text))rememberContext('environment','indoor',confidence)
  if(/\b(outdoor|outdoors|esterno|grass|erba|garden|giardino|street|strada|sidewalk|marciapiede|trail|sentiero|beach|spiaggia|water|acqua)\b/.test(text))rememberContext('environment','outdoor',confidence)
  if(/\b(vehicle|car|auto|automobile)\b/.test(text))rememberContext('environment','vehicle',confidence)
  const scenes=[['home',/\b(home|casa|living room|soggiorno|bedroom|camera da letto)\b/],['garden',/\b(garden|yard|giardino|cortile)\b/],['park',/\bpark|parco\b/],['sidewalk',/\bsidewalk|marciapiede\b/],['street',/\bstreet|strada\b/],['trail',/\btrail|sentiero\b/],['beach',/\bbeach|spiaggia\b/],['water',/\bwater|acqua\b/],['public_indoor',/\bpublic indoor|interno pubblico\b/]]
  for(const [scene,pattern] of scenes)if(pattern.test(text))rememberContext('scene',scene,confidence)
  const surfaces=[['floor',/\bfloor|pavimento\b/],['couch',/\bcouch|sofa|divano\b/],['bed',/\bbed|letto\b/],['chair',/\bchair|sedia\b/],['carpet',/\bcarpet|rug|tappeto\b/],['grass',/\bgrass|lawn|erba|prato\b/],['dirt',/\bdirt|soil|terra\b/],['pavement',/\bpavement|sidewalk|marciapiede\b/],['road',/\broad|carreggiata\b/],['stairs',/\bstairs|steps|scale|gradini\b/],['water',/\bwater|acqua\b/],['vehicle',/\bvehicle|car|auto\b/]]
  for(const [surface,pattern] of surfaces)if(pattern.test(text))rememberContext('surface',surface,confidence)
}

function currentContextPayload(){
  const output={environment:'unknown',scene:'unknown',surface:'unknown',structures:[]}
  for(const type of ['environment','scene','surface']){
    const best=[...contextHypotheses.values()].filter(item=>item.type===type&&(item.count>=2||item.confidence>=.78)).sort((a,b)=>b.confidence-a.confidence||b.count-a.count)[0]
    if(best)output[type]=best.value
  }
  output.hypotheses=[...contextHypotheses.values()].sort((a,b)=>b.confidence-a.confidence).slice(0,12)
  return output
}

function postureCandidateFor(points=[]){
  const point=index=>points[index]?.score>.32?points[index]:null,neck=point(3),tail=point(4),paws=[point(7),point(10),point(13),point(16)].filter(Boolean)
  if(!neck||!tail||paws.length<3)return {value:'unknown',confidence:0}
  const bodyY=(neck.y+tail.y)/2,pawY=paws.reduce((sum,paw)=>sum+paw.y,0)/paws.length,gap=pawY-bodyY,confidence=Math.min(neck.score,tail.score,...paws.map(paw=>paw.score))
  if(gap<.14)return {value:'lying',confidence:confidence*.78}
  if(gap>.25)return {value:'standing',confidence:confidence*.72}
  return {value:'unknown',confidence:confidence*.5}
}

function surfaceCandidateFor(dog,detected=[]){
  const map=new Map([['couch','couch'],['bed','bed'],['chair','chair']]),bottom=dog.box[3]
  const supported=detected.filter(item=>map.has(item.label)&&item.score>.38).map(item=>({item,overlap:Math.max(0,Math.min(dog.box[2],item.box[2])-Math.max(dog.box[0],item.box[0]))}))
    .filter(({item,overlap})=>overlap>.04&&bottom>=item.box[1]-.08&&dog.box[3]<=item.box[3]+.18).sort((a,b)=>b.item.score-a.item.score)[0]
  if(supported)return {value:map.get(supported.item.label),confidence:supported.item.score}
  const context=currentContextPayload(),hypothesis=context.hypotheses.find(item=>item.type==='surface'&&(item.count>=2||item.confidence>=.78))
  return hypothesis?{value:hypothesis.value,confidence:hypothesis.confidence*.82}:{value:'unknown',confidence:0}
}

function updateV2SurfaceStates(dogs,detected){
  for(const dog of dogs){const candidate=surfaceCandidateFor(dog,detected);if(candidate.value==='unknown')continue;const event=narrativeEngine.updateSurface(trackName(dog),candidate.value,currentVideoSeconds()*1000,candidate.confidence);if(event){addEvent(semanticActionTitle(event.action),`${event.description} · ${Math.round(event.confidence*100)}%`,`v2:${event.id}`,[dog],1500);queueSemanticTrigger('surface_change',.92,{actor:event.actor,from:event.from,to:event.to})}}
}

function finishIntervalTransition(transition,action,actor,target,description,source='temporal'){
  if(!transition)return null
  if(transition.type==='start'){queueSemanticTrigger(action,.85,{actor,target});return null}
  return addV2Event({start:transition.start/1000,end:transition.end/1000,actor,action,target,confidence:transition.confidence,description,source,evidence:transition.meta})
}

function updateDogRelationships(objects){
  const dogs=objects.filter(object=>object.label==='dog')
  for(let first=0;first<dogs.length;first++)for(let second=first+1;second<dogs.length;second++){
    const a=dogs[first],b=dogs[second],actor=trackName(a),target=trackName(b),gap=distance(a,b),aMotion=compensateMotion(a,lastCameraMotion),bMotion=compensateMotion(b,lastCameraMotion),relative=Math.hypot(aMotion.dx-bMotion.dx,aMotion.dy-bMotion.dy),active=gap<.26&&(relative>.004||a.motion+b.motion>.018)
    const key=`dog-relation:${[a.id,b.id].sort().join(':')}`,confidence=Math.min(.88,(trackConfidence(a)+trackConfidence(b))/2+(active ? .05 : 0))
    const transition=narrativeEngine.intervals.update(key,currentVideoSeconds()*1000,active,confidence,{gap,relative,cameraConfidence:lastCameraMotion.confidence})
    finishIntervalTransition(transition,'dog_dog_interaction',actor,target,language==='it'?`${actor} e ${target} interagiscono a distanza ravvicinata.`:`${actor} and ${target} interact at close range.`,'detector-temporal')
  }
}

function pointBoxDistance(point,box){
  if(!point)return Infinity
  const dx=Math.max(box[0]-point.x,0,point.x-box[2]),dy=Math.max(box[1]-point.y,0,point.y-box[3]);return Math.hypot(dx,dy)
}

function updateObjectStates(objects){
  const dogs=objects.filter(item=>item.label==='dog'),items=objects.filter(item=>dogInterestLabels.has(item.label))
  const seen=new Set()
  for(const dog of dogs)for(const item of items){
    const key=`${dog.id}:${item.id}`;seen.add(key);const previous=objectRelations.get(key)||{state:'visible',distance:Infinity,lastAt:currentVideoSeconds()},gap=distance(dog,item),mouthDistance=pointBoxDistance(dog.poseKeypoints?.[2],item.box),movingTogether=gap<.16&&dog.motion>.008&&item.motion>.006
    let state=mouthDistance<.055?'mouth_contact':gap<.13?'contact':previous.distance-gap>.035?'approaching':'visible'
    if((previous.state==='mouth_contact'||previous.state==='holding'||previous.state==='carrying')&&movingTogether)state=dog.travel>.08?'carrying':'holding'
    const confidence=Math.min(.92,(trackConfidence(dog)+trackConfidence(item))/2+(mouthDistance < .055 ? .08 : 0))
    if(state!==previous.state){
      const actions={mouth_contact:'mouth_contact',holding:'holding',carrying:'carrying',approaching:'approaching'}
      if(actions[state])addV2Event({actor:trackName(dog),action:actions[state],target:trackName(item),objects:[{id:item.id,label:item.label}],confidence,description:language==='it'?`${trackName(dog)} entra in contatto con ${trackName(item)}.`:`${trackName(dog)} interacts with ${trackName(item)}.`,source:'object-state',evidence:{detector:true,mouthDistance,gap}})
      if(['mouth_contact','holding','carrying'].includes(state))queueSemanticTrigger('object_interaction',.9,{actor:trackName(dog),object:item.label,state})
    }
    objectRelations.set(key,{state,distance:gap,lastAt:currentVideoSeconds(),dog,item,confidence})
  }
  for(const [key,previous] of objectRelations)if(!seen.has(key)&&currentVideoSeconds()-previous.lastAt>.8){
    if(['holding','carrying','mouth_contact'].includes(previous.state))addV2Event({actor:trackName(previous.dog),action:'dropping',target:trackName(previous.item),objects:[{id:previous.item.id,label:previous.item.label}],confidence:previous.confidence*.82,description:language==='it'?`${trackName(previous.dog)} lascia l'oggetto.`:`${trackName(previous.dog)} releases the object.`,source:'object-state'})
    objectRelations.delete(key)
  }
}

function recordRawDebug(objects,detected){
  const now=Date.now();if(now-lastRawDebugAt<350)return;lastRawDebugAt=now
  debugRecorder.addRaw({videoSeconds:currentVideoSeconds(),detections:objects.map(item=>({id:item.id,label:item.label,name:trackName(item),box:item.box,confidence:trackConfidence(item),motion:compensateMotion(item,lastCameraMotion)})),pose:objects.filter(item=>item.label==='dog').map(item=>({dogId:trackName(item),keypoints:item.poseKeypoints||[],cues:item.poseCues||[]})),hands:handCues,cameraMotion:lastCameraMotion,contextCandidates:detected.filter(item=>environmentLabels.has(item.label)||dogInterestLabels.has(item.label)).slice(0,8)})
  if(debugRecorder.raw.length>1600)debugRecorder.raw.splice(0,debugRecorder.raw.length-1600)
}

function acceptSemanticEvent(event,item){
  const action=String(event.action||'other'),confidence=Math.max(0,Math.min(1,Number(event.confidence)||0)),target=String(event.target||'').trim(),objectAction=new Set(['mouth_contact','biting','chewing','eating','drinking','holding','carrying','picking_up','dropping','throwing','offering','using_object','tugging','fetching']).has(action)
  if(new Set(['sleeping','biting','eating','drinking','urinating','defecating']).has(action)&&confidence<.74)return null
  if(objectAction&&target){
    const detectorSupported=lastFacts.some(fact=>fact.interest||(!fact.context&&String(fact.name||fact.label).toLowerCase()===target.toLowerCase()))
    if(!detectorSupported){
      const generic=/^(object|toy|rope-like toy|stick|leash|oggetto|gioco|corda|bastone|guinzaglio)$/i.test(target),key=`${event.actor||'unknown'}:${action}:${target.toLowerCase()}`,state=objectHypotheses.get(key)||{count:0,confidence:0}
      state.count++;state.confidence=Math.max(state.confidence,confidence);state.lastAt=currentVideoSeconds();objectHypotheses.set(key,state)
      if(state.count<2||confidence<(generic ? .70 : .78))return null
    }
  }
  return addV2Event({start:Math.max(0,currentVideoSeconds()-2.5),end:currentVideoSeconds(),actor:event.actor||null,action,target:target||null,objects:objectAction&&target?[{label:target}]:[],confidence,description:event.detail||item.summary,source:'visionpsy',evidence:{frames:item.evidence?.frames||3,detector:item.evidence?.detector||0,trigger:item.trigger||null}})
}

function observeContextFromNarrative(summary){
  // Context is evidence from Vision's description, never a colour-based guess.
  const text=String(summary||'').toLowerCase()
  if(/\b(erba|erbosa|prato|giardino|grass|grassy|lawn|garden)\b/.test(text))sessionContext.add('grassy-outdoor-area')
  if(/\b(pavimento|interno|stanza|floor|indoors?|room)\b/.test(text))sessionContext.add('indoor-floor')
  observeContextHypotheses(summary,.68)
}

function sessionNarrative(){
  const history=sessionEvents.length?sessionEvents:events,seen=new Set(),details=[]
  for(const event of [...history].reverse()){
    if(event.stableKey?.startsWith('detected:')||event.stableKey?.startsWith('dog-pose:'))continue
    const detail=String(event.detail||'').replace(/ · \d+%$/,'').trim(),key=detail.toLowerCase().replace(/\d+/g,'')
    if(detail&&detail.length>8&&!seen.has(key)){seen.add(key);details.push(detail)}
    if(details.length===5)break
  }
  return details.join(' ')||history.map(event=>String(event.detail||'').replace(/ · \d+%$/,'')).filter(Boolean).slice(-3).join(' ')
}

function flushNarrativeIntervals(){
  const at=currentVideoSeconds()*1000,allTracks=[...tracks,...retiredTracks]
  for(const transition of narrativeEngine.intervals.flush(at)){
    if(transition.key.startsWith('petting:')){const id=Number(transition.key.split(':')[1]),dog=allTracks.find(item=>item.id===id),actor=dog?trackName(dog):'dog';addV2Event({start:transition.start/1000,end:transition.end/1000,actor,action:'petting',target:'person',confidence:transition.confidence,description:language==='it'?`Una persona accarezza ${actor}.`:`A person pets ${actor}.`,source:'mediapipe-hand',evidence:transition.meta},{show:false})}
    if(transition.key.startsWith('dog-relation:')){const ids=transition.key.split(':').slice(1).map(Number),subjects=ids.map(id=>allTracks.find(item=>item.id===id)).filter(Boolean),actor=subjects[0]?trackName(subjects[0]):'dog',target=subjects[1]?trackName(subjects[1]):'dog';addV2Event({start:transition.start/1000,end:transition.end/1000,actor,action:'dog_dog_interaction',target,confidence:transition.confidence,description:language==='it'?`${actor} e ${target} interagiscono a distanza ravvicinata.`:`${actor} and ${target} interact at close range.`,source:'detector-temporal',evidence:transition.meta},{show:false})}
  }
  for(const actor of narrativeEngine.tail.byActor.keys()){const transition=narrativeEngine.tail.flush(actor,at);if(transition)addV2Event({start:transition.start/1000,end:transition.end/1000,actor,action:'tail_wagging',confidence:transition.confidence,description:language==='it'?`${actor} muove ripetutamente la coda.`:`${actor} repeatedly wags its tail.`,source:'pose'},{show:false})}
}

function finalEvidenceSequences(merged,duration){
  if(!coverageFrames.length)return []
  const selected=summaryPayload(merged,{sessionDuration:duration,maxEvents:6,context:currentContextPayload()}).events,targets=[...selected.sort((a,b)=>b.importance-a.importance).slice(0,2).map(event=>(event.start+event.end)/2),duration*.12,duration*.52,duration*.9].filter(Number.isFinite),chosen=[]
  for(const target of targets){const closest=[...coverageFrames].sort((a,b)=>Math.abs(a.videoSeconds-target)-Math.abs(b.videoSeconds-target))[0];if(closest&&!chosen.includes(closest))chosen.push(closest);if(chosen.length===4)break}
  return chosen.map(item=>{
    const ordered=[...coverageFrames].sort((a,b)=>a.videoSeconds-b.videoSeconds),index=ordered.indexOf(item),frames=[ordered[Math.max(0,index-1)],item,ordered[Math.min(ordered.length-1,index+1)]].filter((frame,position,array)=>frame&&array.indexOf(frame)===position),sheet=document.createElement('canvas');sheet.width=960;sheet.height=320;const context=sheet.getContext('2d');context.fillStyle='#08100b';context.fillRect(0,0,960,320)
    frames.forEach((frame,frameIndex)=>{context.drawImage(frame.frame,frameIndex*320,0,320,320);context.fillStyle='rgba(4,12,7,.76)';context.fillRect(frameIndex*320+8,8,34,22);context.fillStyle='#dff5e5';context.font='600 13px sans-serif';context.fillText(String(frameIndex+1),frameIndex*320+20,24)})
    return {at:item.videoSeconds,frameCount:frames.length,image:sheet.toDataURL('image/jpeg',.8),subjects:frames.flatMap(frame=>frame.subjects||[])}
  })
}

function fallbackV2Narrative(merged){
  const selected=summaryPayload(merged,{sessionDuration:currentSessionDuration(),maxEvents:6,context:currentContextPayload()}).events,details=selected.map(event=>String(event.description||'').trim()).filter(Boolean)
  if(!details.length)return sessionNarrative()
  return details.join(' ')
}

function renderSessionFacts(merged){
  const facts=[],dogs=sessionMaxVisible.get('dog')||0,rawCount=debugRecorder.raw.filter(item=>item.type!=='visionpsy'&&item.type!=='visionpsy-error').length
  if(dogs)facts.push(language==='it'?`${dogs} cani rilevati`:`${dogs} dogs detected`)
  const context=currentContextPayload();if(context.surface!=='unknown')facts.push(`${language==='it'?'superficie':'surface'}: ${context.surface}`);if(context.scene!=='unknown')facts.push(`${language==='it'?'scena':'scene'}: ${context.scene}`)
  if(currentSource?.kind==='youtube')facts.push(`YouTube · ${currentSource.title}`)
  facts.push(`${rawCount} ${t('rawObservations')}`);facts.push(`${merged.length} ${t('behaviourEvents')}`)
  sessionSummaryFacts.replaceChildren(...facts.map(text=>Object.assign(document.createElement('span'),{textContent:text})))
}

async function finalizeSession(){
  if(lastFinalResult)return lastFinalResult
  flushNarrativeIntervals();const duration=currentSessionDuration(),merged=narrativeEngine.merge(),payload=summaryPayload(merged,{sessionDuration:duration,maxEvents:8,context:currentContextPayload()}),seekable=currentSource?.kind!=='camera'&&Number.isFinite(video.duration)
  debugRecorder.meta={...debugRecorder.meta,source:currentSource,duration,rawObservationCount:debugRecorder.raw.length,legacyEventCount:sessionEvents.length}
  if(!seekable){lastFinalResult={events:merged,summary:null,context:currentContextPayload()};return lastFinalResult}
  finalizingSession=true
  try{
    const response=await fetch('/api/finalize-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language,source:currentSource,sessionDuration:duration,events:merged,story:payload,evidenceSequences:finalEvidenceSequences(merged,duration),context:currentContextPayload()})})
    const result=response.ok?await response.json():null
    if(result?.events?.length)narrativeEngine.semantic=result.events
    if(result)debugRecorder.addRaw({type:'final-review',videoSeconds:duration,reviews:result.reviews||[],context:result.context||{}})
    lastFinalResult=result||{events:merged,summary:null,context:currentContextPayload()}
  }catch(error){debugRecorder.addRaw({type:'finalize-error',message:String(error?.message||error),videoSeconds:currentVideoSeconds()});lastFinalResult={events:merged,summary:null,context:currentContextPayload()}}
  finally{finalizingSession=false}
  return lastFinalResult
}

async function showSessionSummary({finalPass=false}={}){
  sessionSummaryText.textContent=finalPass?t('finalising'):(language==='it'?'Rielaborazione degli eventi…':'Summarising observed events…');sessionModal.hidden=false
  const preliminary=narrativeEngine.merge();renderSessionFacts(preliminary)
  try{
    let result=finalPass?await finalizeSession():lastFinalResult
    const merged=result?.events?.length?result.events:preliminary
    if(!result?.summary&&merged.length){const response=await fetch('/api/session-summary',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language,version:2,sessionDuration:currentSessionDuration(),context:currentContextPayload(),events:summaryPayload(merged,{sessionDuration:currentSessionDuration(),maxEvents:8,context:currentContextPayload()}).events})});if(response.ok)result={...(result||{}),...(await response.json())}}
    const summary=result?.summary||fallbackV2Narrative(merged);sessionSummaryText.textContent=summary;debugRecorder.setMerged(merged);debugRecorder.setSummary(summary);renderSessionFacts(merged)
  }catch{const merged=narrativeEngine.merge(),summary=fallbackV2Narrative(merged);sessionSummaryText.textContent=summary;debugRecorder.setMerged(merged);debugRecorder.setSummary(summary);renderSessionFacts(merged)}
}
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
function filtered(objects){ return objects.filter(o=>{const confidence=trackConfidence(o),minimum=animalLabels.has(o.label)&&!['dog','cat'].includes(o.label)?.62:o.label==='person'||['dog','cat'].includes(o.label)?.45:.5;return confidence>=minimum&&((o.evidenceFrames||1)>=2||confidence>=.7)&&(activeFilter==='all'||category(o.label)===activeFilter)}).slice(0,4) }
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

async function initHandCues(){
  try{
    const {FilesetResolver,HandLandmarker}=await import('/mediapipe/vision_bundle.mjs'),vision=await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    handLandmarker=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'/models/hand_landmarker.task'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55})
  }catch{handLandmarker=null}
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

function analyseHandCues(objects){
  const now=performance.now(),dogs=objects.filter(object=>object.label==='dog'),people=objects.filter(object=>object.label==='person')
  if(!handLandmarker||!dogs.length||now<nextHandCueAt)return
  nextHandCueAt=now+350
  try{
    const result=handLandmarker.detectForVideo(capture,now),hands=result.landmarks||[],wallNow=Date.now()
    handCues=[]
    for(const dog of dogs){
      const contacts=[]
      for(const points of hands){
        const useful=[points[0],points[5],points[9],points[13],points[17]].filter(Boolean)
        if(!useful.length)continue
        const x=useful.reduce((sum,point)=>sum+point.x,0)/useful.length,y=useful.reduce((sum,point)=>sum+point.y,0)/useful.length,pad=.035
        if(x>=dog.box[0]-pad&&x<=dog.box[2]+pad&&y>=dog.box[1]-pad&&y<=dog.box[3]+pad)contacts.push({x,y,at:wallNow})
      }
      const history=(handDogContact.get(dog.id)||[]).filter(item=>wallNow-item.at<1800)
      history.push(...contacts);handDogContact.set(dog.id,history)
      const travel=history.slice(1).reduce((sum,item,index)=>sum+Math.hypot(item.x-history[index].x,item.y-history[index].y),0),duration=history.length>1?history.at(-1).at-history[0].at:0
      const active=history.length>=3&&duration>=650&&travel>.025,score=Math.min(.94,.58+history.length*.035+travel*.4+(people.length ? .06 : 0)),text=language==='it'?`Una persona accarezza ${trackName(dog)}`:`A person pets ${trackName(dog)}`
      const transition=narrativeEngine.intervals.update(`petting:${dog.id}`,currentVideoSeconds()*1000,active,score,{hands:history.length,handTravel:travel,personDetected:Boolean(people.length)})
      finishIntervalTransition(transition,'petting',trackName(dog),'person',text,'mediapipe-hand')
      if(active){
        const cue={code:'petting',text,score,at:wallNow};handCues.push(cue);addEvent(t('petting'),`${text} · ${Math.round(score*100)}%`,`hand:petting:${dog.id}`,[...people.slice(0,1),dog],7000)
      }
    }
  }catch{handCues=[]}
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
  nextAnimalPoseAt=now+350
  for(const dog of dogs){
    const crop=paddedSquare(dog.box),previous=dog.poseKeypoints||[]
    poseCropCtx.drawImage(capture,crop.x*640,crop.y*640,crop.size*640,crop.size*640,0,0,256,256)
    const rgba=poseCropCtx.getImageData(0,0,256,256).data,rgb=new Uint8Array(256*256*3)
    for(let source=0,target=0;source<rgba.length;source+=4){rgb[target++]=rgba[source];rgb[target++]=rgba[source+1];rgb[target++]=rgba[source+2]}
    try{
      const response=await fetch('/api/pose',{method:'POST',headers:{'content-type':'application/octet-stream'},body:rgb});if(!response.ok)continue
      const result=await response.json(),localPoints=Array.isArray(result.keypoints)?result.keypoints:[]
      dog.poseCues=poseCuesFor(localPoints,previous.map(point=>point.local||point));dog.poseKeypoints=localPoints.map(point=>({...point,x:crop.x+point.x*crop.size,y:crop.y+point.y*crop.size,local:point}));dog.poseAt=Date.now()
      const posture=postureCandidateFor(localPoints),postureEvent=narrativeEngine.updatePosture(trackName(dog),posture.value,currentVideoSeconds()*1000,posture.confidence)
      if(postureEvent){addEvent(semanticActionTitle(postureEvent.action),`${postureEvent.description} · ${Math.round(postureEvent.confidence*100)}%`,`v2:${postureEvent.id}`,[dog],1500);queueSemanticTrigger('posture_change',.88,{actor:postureEvent.actor,action:postureEvent.action})}
      const tail=localPoints[4],tailWasActive=narrativeEngine.tail.byActor.get(trackName(dog))?.active||false,tailEvent=tail?.score>.3?narrativeEngine.updateTail(trackName(dog),currentVideoSeconds()*1000,tail.x,tail.score):null,tailIsActive=narrativeEngine.tail.byActor.get(trackName(dog))?.active||false
      if(!tailWasActive&&tailIsActive)queueSemanticTrigger('tail_oscillation',.72,{actor:trackName(dog)})
      if(tailEvent)addEvent(semanticActionTitle(tailEvent.action),`${tailEvent.description} · ${Math.round(tailEvent.confidence*100)}%`,`v2:${tailEvent.id}`,[dog],1500)
      const cue=dog.poseCues[0]
      if(cue&&cue.code!=='tail-root-motion'&&cue.score>=.55)addEvent(t('animalActivity'),`${trackName(dog)} ${cue.text} · ${Math.round(cue.score*100)}%`,`dog-pose:${dog.id}:${cue.code}`,[dog],7000)
    }catch{}
  }
}

function considerSemanticFrame(rgba,objects){
  const now=Date.now()
  if(!objects.length){if(now-(semanticFrames.at(-1)?.at||0)>2500)semanticFrames.splice(0);return}
  if(now-lastSemanticSampleAt<550)return
  const frame=document.createElement('canvas');frame.width=640;frame.height=640;frame.getContext('2d').drawImage(capture,0,0)
  const subjects=objects.map(object=>({label:object.label,box:[...object.box],motion:object.motion||0,score:trackConfidence(object)}))
  semanticFrames.push({frame,subjects,at:now,sharpness:frameSharpness(rgba)});semanticFrames.splice(0,Math.max(0,semanticFrames.length-8));lastSemanticSampleAt=now
  if(!coverageFrames.length||currentVideoSeconds()-coverageFrames.at(-1).videoSeconds>=2.5){coverageFrames.push({frame,subjects,videoSeconds:currentVideoSeconds()});if(coverageFrames.length>30)coverageFrames.shift()}
}

function evidenceCrop(subjects){
  if(!subjects?.length)return {x:0,y:0,size:1}
  const dogs=subjects.filter(subject=>subject.label==='dog'),person=subjects.find(subject=>subject.label==='person'),items=subjects.filter(subject=>dogInterestLabels.has(subject.label))
  let selected=[]
  if(person&&dogs.length){const dog=[...dogs].sort((a,b)=>distance(person,a)-distance(person,b))[0];if(distance(person,dog)<.45)selected=[person,dog]}
  if(!selected.length&&dogs.length>=2&&distance(dogs[0],dogs[1])<.45)selected=dogs.slice(0,2)
  if(!selected.length&&dogs.length&&items.length){const pairs=dogs.flatMap(dog=>items.map(item=>({dog,item,gap:distance(dog,item)}))).sort((a,b)=>a.gap-b.gap);if(pairs[0]?.gap<.38)selected=[pairs[0].dog,pairs[0].item]}
  if(!selected.length)selected=[[...subjects].sort((a,b)=>(b.motion+b.score*.1)-(a.motion+a.score*.1))[0]]
  const box=[Math.min(...selected.map(item=>item.box[0])),Math.min(...selected.map(item=>item.box[1])),Math.max(...selected.map(item=>item.box[2])),Math.max(...selected.map(item=>item.box[3]))]
  return paddedSquare(box,1.45)
}

function semanticSequenceSource(){
  if(semanticFrames.length<2)return {source:semanticFrames.at(-1)?.frame||capture,count:1}
  semanticContactSheetCtx.fillStyle='#08100b';semanticContactSheetCtx.fillRect(0,0,960,640)
  const recent=semanticFrames.filter(item=>Date.now()-item.at<5000),pool=recent.length>=3?recent:semanticFrames
  const frames=pool.length<=3?pool:[pool[0],pool[Math.floor((pool.length-1)/2)],pool.at(-1)]
  frames.forEach((item,index)=>{
    const x=index*320,crop=evidenceCrop(item.subjects)
    semanticContactSheetCtx.drawImage(item.frame,0,0,640,640,x,0,320,320)
    semanticContactSheetCtx.drawImage(item.frame,crop.x*640,crop.y*640,crop.size*640,crop.size*640,x,320,320,320)
    for(const [y,label] of [[0,`${index+1}`],[320,`${index+1}×`]]){semanticContactSheetCtx.fillStyle='rgba(4,12,7,.76)';semanticContactSheetCtx.fillRect(x+8,y+8,32,22);semanticContactSheetCtx.fillStyle='#dff5e5';semanticContactSheetCtx.font='600 13px -apple-system,sans-serif';semanticContactSheetCtx.fillText(label,x+14,y+24)}
  })
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
    const dormant=tracks.filter(track=>track.label===object.label&&track.missed>0&&track.missed<22).map(track=>({track,visual:appearanceDistance(track.appearance,object.appearance),spatial:distance({box:predictedBox(track)},object)})).sort((first,second)=>(first.visual+first.spatial*.35)-(second.visual+second.spatial*.35))[0]
    if(dormant&&(dormant.visual<.46||dormant.spatial<.5)){updateTrack(dormant.track,object);continue}
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
  const confidenceMatch=String(detail).match(/ · (\d+)%$/),event={title,detail,stableKey,subjects,at:new Date(),confidence:confidenceMatch?Number(confidenceMatch[1])/100:null,videoSeconds:Number.isFinite(video.currentTime)?Number(video.currentTime.toFixed(1)):null}
  events.unshift(event);events.splice(5);sessionEvents.push(event);if(sessionEvents.length>200)sessionEvents.splice(0,sessionEvents.length-200)
  sessionSummaryButton.hidden=false
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

function semanticActionTitle(action){
  if(action==='facial_gesture')return t('facialCue')
  if(['petting','playing','chasing','biting'].includes(action))return t(action==='playing'?'playing':action)
  return t(action)||t('visualDetail')
}

function showSource(kind,title=''){
  currentSource={kind,title:String(title||'').trim()}
  debugRecorder.source=currentSource
  const prefix=kind==='camera'?t('cameraSource'):kind==='youtube'?t('youtubeSource'):t('fileSource')
  sourceBadge.textContent=currentSource.title?`${prefix} · ${currentSource.title}`:prefix
  sourceBadge.hidden=false
}

function stopCurrentSource(){
  deepAnalysisToken++;deepProgress.hidden=true
  running=false
  if(timer){clearInterval(timer);timer=null}
  if(video.srcObject){video.srcObject.getTracks().forEach(track=>track.stop());video.srcObject=null}
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
  video.pause();video.controls=false;video.removeAttribute('src');video.load()
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
    updateCameraMotion(payload.objects||[])
    for(const label of new Set(allCurrent.filter(object=>object.missed===0&&trackConfidence(object)>=.58).map(object=>object.label))){const count=allCurrent.filter(object=>object.label===label&&object.missed===0&&trackConfidence(object)>=.58).length;sessionMaxVisible.set(label,Math.max(sessionMaxVisible.get(label)||0,count))}
    recordTemporalWindows(allCurrent)
    recordDogToyRelations(allCurrent)
    considerSemanticFrame(rgba,current)
    analyseFaceCues(allCurrent)
    analyseHandCues(allCurrent)
    await analyseAnimalPose(allCurrent)
    updateV2SurfaceStates(allCurrent.filter(object=>object.label==='dog'),payload.objects||[])
    updateDogRelationships(allCurrent)
    updateObjectStates(allCurrent)
    const now=Date.now(),recentFaceCues=faceCues.filter(cue=>now-cue.at<4000),recentHandCues=handCues.filter(cue=>now-cue.at<4000),trackedFacts=current.map((object,index)=>({id:object.id,label:object.label,name:trackName(object),color:object.color,score:trackConfidence(object),rawScore:object.score,frames:object.evidenceFrames||1,motion:object.motion,motionText:now-(object.lastMotionAt||0)<6500?object.lastMotionText:null,size:apparentSize(object),faceCues:object.label==='person'&&index===current.findIndex(item=>item.label==='person')?recentFaceCues:[],handCues:object.label==='person'&&index===current.findIndex(item=>item.label==='person')?recentHandCues:[],poseCues:object.label==='dog'&&now-(object.poseAt||0)<2500?(object.poseCues||[]):[]}))
    const dogVisible=allCurrent.some(object=>object.label==='dog'),trackedLabels=new Set(trackedFacts.map(fact=>fact.label)),contextFacts=dogVisible?(payload.objects||[]).filter(object=>(environmentLabels.has(object.label)||dogInterestLabels.has(object.label))&&!trackedLabels.has(object.label)&&object.score>.36).slice(0,4).map(object=>({label:object.label,name:displayLabel(object.label),score:object.score,context:true,interest:dogInterestLabels.has(object.label)})):[]
    lastFacts=[...trackedFacts,...contextFacts]
    recordRawDebug(allCurrent,payload.objects||[])
    draw(current);summarize(current)
    const elapsed=performance.now()-started;fpsLabel.textContent=`${(1000/Math.max(1,elapsed)).toFixed(1)} AI fps`
    if(visionpsyEnabled&&!interpreting){
      const trigger=pendingSemanticTrigger&&Date.now()>=pendingSemanticTrigger.readyAt?pendingSemanticTrigger:null
      if(trigger||Date.now()>=nextInterpretAt){nextInterpretAt=Date.now()+sceneTempo(allCurrent).semanticGapMs;interpret(trigger)}
    }
  }catch(error){statusDot.className='error';statusText.textContent=String(error.message||error).slice(0,70)}finally{busy=false}
}

async function interpret(trigger=null){
  if(interpreting)return
  interpreting=true
  if(trigger&&pendingSemanticTrigger===trigger)pendingSemanticTrigger=null
  const sequence=semanticSequenceSource(),blob=await new Promise(resolve=>sequence.source.toBlob(resolve,'image/jpeg',.84));if(!blob){interpreting=false;return}
  try{
    const response=await fetch('/api/interpret',{method:'POST',headers:{'content-type':'image/jpeg','x-vision-facts':JSON.stringify(lastFacts),'x-language':language,'x-frame-count':String(sequence.count),'x-narrative-trigger':JSON.stringify(trigger||{type:'baseline'})},body:blob});if(!response.ok)return
    const item=await response.json(),semanticFacts=item.dogVerified===false?lastFacts.filter(fact=>fact.label!=='dog'&&!fact.context):lastFacts,confidence=`${Math.round(Number(item.confidence||0)*100)}%`
    item.trigger=trigger||null;debugRecorder.addRaw({type:'visionpsy',videoSeconds:currentVideoSeconds(),trigger:trigger||{type:'baseline'},response:item});observeContextFromNarrative(`${typeof item.context==='string'?item.context:JSON.stringify(item.context||{})} ${item.summary||''}`);lastInterpretationAt=Date.now();setScene(item.summary||t('empty'),semanticFacts,{confidence})
    const structured=Array.isArray(item.events)?item.events:[]
    if(structured.length){for(const event of structured){const percent=`${Math.round(Number(event.confidence||0)*100)}%`,detail=`${event.detail} · ${percent}`;addEvent(semanticActionTitle(event.action),detail,`semantic:${event.action}:${event.actor}:${event.target}`,semanticFacts,7000);acceptSemanticEvent(event,item)}}
    else addEvent(semanticTitle(item),`${item.summary} · ${confidence}`,`semantic:${item.kind||'visual'}`,semanticFacts)
  }catch(error){debugRecorder.addRaw({type:'visionpsy-error',videoSeconds:currentVideoSeconds(),message:String(error?.message||error)})}finally{interpreting=false;nextInterpretAt=pendingSemanticTrigger?Math.min(nextInterpretAt,pendingSemanticTrigger.readyAt):Math.max(nextInterpretAt,Date.now()+1500)}
}

function setDeepProgress(phase,completed,total,detail=''){
  const percent=total?Math.round(completed/total*100):0
  deepProgress.hidden=false;deepPhase.textContent=phase;deepPercent.textContent=`${percent}%`;deepProgressBar.value=percent;deepDetail.textContent=detail
}

function waitForVideoEvent(name,timeout=12_000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error(`video ${name} timeout`))},timeout),cleanup=()=>{clearTimeout(timer);video.removeEventListener(name,onEvent);video.removeEventListener('error',onError)},onEvent=()=>{cleanup();resolve()},onError=()=>{cleanup();reject(new Error(video.error?.message||'video error'))};video.addEventListener(name,onEvent,{once:true});video.addEventListener('error',onError,{once:true})})}
async function seekDeepVideo(time){if(Math.abs(video.currentTime-time)<.002){await new Promise(resolve=>requestAnimationFrame(resolve));return}const ready=waitForVideoEvent('seeked');video.currentTime=Math.max(0,Math.min(video.duration-.001,time));await ready}

function deepRgbFromCapture(){
  const rgba=captureCtx.getImageData(0,0,640,640).data,rgb=new Uint8Array(640*640*3)
  for(let source=0,target=0;source<rgba.length;source+=4){rgb[target++]=rgba[source];rgb[target++]=rgba[source+1];rgb[target++]=rgba[source+2]}
  return {rgba,rgb}
}

function assignTemporaryTrackIds(detections,fragments,nextId,time){
  const claimed=new Set()
  return detections.map(detection=>{let best=null;for(const fragment of fragments.values()){if(fragment.label!==detection.label||claimed.has(fragment.id)||time-fragment.lastSeen>1.2)continue;const overlap=iou(fragment.box,detection.box),gap=Math.hypot((fragment.box[0]+fragment.box[2]-detection.box[0]-detection.box[2])/2,(fragment.box[1]+fragment.box[3]-detection.box[1]-detection.box[3])/2),score=overlap*.72+(1-Math.min(1,gap/.5))*.28;if(!best||score>best.score)best={fragment,score}}let id;if(best&&best.score>.32){id=best.fragment.id;claimed.add(id)}else{id=`track_${nextId.value++}`;fragments.set(id,{id,label:detection.label,box:detection.box,lastSeen:time})}fragments.set(id,{id,label:detection.label,box:[...detection.box],lastSeen:time});return {...detection,track_id:id}})
}

async function deepPoseFor(box){
  const crop=paddedSquare(box),rgba=(()=>{poseCropCtx.drawImage(capture,crop.x*640,crop.y*640,crop.size*640,crop.size*640,0,0,256,256);return poseCropCtx.getImageData(0,0,256,256).data})(),rgb=new Uint8Array(256*256*3)
  for(let source=0,target=0;source<rgba.length;source+=4){rgb[target++]=rgba[source];rgb[target++]=rgba[source+1];rgb[target++]=rgba[source+2]}
  const response=await fetch('/api/pose',{method:'POST',headers:{'content-type':'application/octet-stream'},body:rgb});if(!response.ok)return []
  const result=await response.json();return (result.keypoints||[]).map(point=>({...point,x:crop.x+point.x*crop.size,y:crop.y+point.y*crop.size,local:point}))
}

function deepThumbnail(){const thumb=document.createElement('canvas');thumb.width=320;thumb.height=180;thumb.getContext('2d').drawImage(video,0,0,320,180);return thumb.toDataURL('image/jpeg',.58)}
function loadDeepImage(source){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=source})}
async function deepContactSheet(interval,observations){
  const inside=observations.filter(item=>item.time>=interval.start&&item.time<=interval.end),pool=inside.length?inside:[...observations].sort((a,b)=>Math.abs(a.time-(interval.start+interval.end)/2)-Math.abs(b.time-(interval.start+interval.end)/2)).slice(0,4),count=Math.max(4,Math.min(8,Math.ceil(Math.max(1,interval.end-interval.start)*1.5))),selected=[]
  for(let index=0;index<count;index++){const target=interval.start+(interval.end-interval.start)*(count===1?0:index/(count-1)),closest=[...pool].sort((a,b)=>Math.abs(a.time-target)-Math.abs(b.time-target))[0];if(closest&&!selected.includes(closest))selected.push(closest)}
  const columns=4,rows=Math.ceil(selected.length/columns),sheet=document.createElement('canvas');sheet.width=960;sheet.height=240*rows;const context=sheet.getContext('2d');context.fillStyle='#07100b';context.fillRect(0,0,sheet.width,sheet.height)
  const images=await Promise.all(selected.map(item=>loadDeepImage(item.image)))
  images.forEach((image,index)=>{const x=index%columns*240,y=Math.floor(index/columns)*240;context.drawImage(image,x,y,240,240);context.fillStyle='rgba(3,10,6,.78)';context.fillRect(x+7,y+7,74,22);context.fillStyle='#e4f5e9';context.font='600 12px sans-serif';context.fillText(`${selected[index].time.toFixed(1)}s`,x+14,y+22)})
  return {image:sheet.toDataURL('image/jpeg',.78),frame_count:selected.length,timestamps:selected.map(item=>item.time)}
}

function deepBoxCenter(box){return {x:(box[0]+box[2])/2,y:(box[1]+box[3])/2}}
function deepWorldMotion(subject,previous,cameraMotion){
  if(!previous)return {observed:{dx:0,dy:0,magnitude:0},compensated:{dx:0,dy:0,magnitude:0,valid:false}}
  const currentCenter=deepBoxCenter(subject.box),previousCenter=deepBoxCenter(previous.box),dx=currentCenter.x-previousCenter.x,dy=currentCenter.y-previousCenter.y,valid=Number(cameraMotion.confidence)>=.28,worldDx=valid?dx-Number(cameraMotion.dx||0):0,worldDy=valid?dy-Number(cameraMotion.dy||0):0
  return {observed:{dx,dy,magnitude:Math.hypot(dx,dy)},compensated:{dx:worldDx,dy:worldDy,magnitude:Math.hypot(worldDx,worldDy),valid}}
}

async function runDeepRecordedAnalysis(){
  const token=++deepAnalysisToken;deepAnalysisComplete=false;deepFinalResult=null;video.pause();video.controls=false;running=false
  const duration=Number(video.duration);if(!Number.isFinite(duration)||duration<=0)throw new Error('Recorded video duration unavailable')
  narrativeVersion.textContent='VISIONPSY · DEEP VIDEO V3';deepDebugRecorder=new DeepVideoDebugRecorder({source:currentSource});debugRecorder.meta={...debugRecorder.meta,analysis_mode:'recorded_deep_v3'}
  const sampleFps=duration>300?5:6,step=1/sampleFps,totalFrames=Math.max(1,Math.floor(duration/step)+1),identity=new PersistentIdentityManager({newSubjectFrames:Math.max(8,Math.round(sampleFps*1.8))}),camera=new BackgroundMotionEstimator(),surfaces=new PersistentSurfaceMap(),posture=new TemporalPostureClassifier(),fragments=new Map(),nextFragment={value:1},previousSubjects=new Map(),objectFirstSeen=new Map(),observations=[],semanticEvents=[];let poseFrames=0,cameraConfidenceSum=0
  setDeepProgress(t('deepPassA'),0,totalFrames,t('deepPreparing'))
  for(let frameIndex=0;frameIndex<totalFrames;frameIndex++){
    if(token!==deepAnalysisToken)return;const time=Math.min(duration-.001,frameIndex*step);await seekDeepVideo(time);captureCtx.drawImage(video,0,0,640,640);const {rgba,rgb}=deepRgbFromCapture(),response=await fetch('/api/detect',{method:'POST',headers:{'content-type':'application/octet-stream'},body:rgb});if(!response.ok)throw new Error((await response.json()).error||`detector ${response.status}`)
    const payload=await response.json(),detected=(payload.objects||[]).filter(item=>item.score>=.24),dynamicBoxes=detected.filter(item=>!environmentLabels.has(item.label)).map(item=>item.box),cameraMotion=camera.update(rgba,640,640,dynamicBoxes);cameraConfidenceSum+=cameraMotion.confidence;deepDebugRecorder.camera_motion_metrics.frames++;if(cameraMotion.confidence>=.28)deepDebugRecorder.camera_motion_metrics.confident_frames++
    const temporary=assignTemporaryTrackIds(detected,fragments,nextFragment,time).map(item=>({...item,descriptor:item.label==='dog'?appearanceDescriptor(rgba,640,640,item.box):null})),dogs=identity.update(temporary,time,cameraMotion),byTrack=new Map(dogs.map(item=>[item.track_id,item])),subjects=temporary.map(item=>item.label==='dog'?(byTrack.get(item.track_id)||item):item.label==='person'?{...item,subject_id:'person_1',identity_decision:'matched'}:item)
    for(const subject of subjects.filter(item=>item.label==='dog'))deepDebugRecorder.recordIdentity({time,track_id:subject.track_id,subject_id:subject.subject_id,reid_score:subject.reid_score,reid_components:subject.reid_components,identity_decision:subject.identity_decision})
    surfaces.updateDetections(detected,time);const frameEvents=[]
    for(const subject of subjects.filter(item=>item.label==='dog'&&item.subject_id)){
      const motion=deepWorldMotion(subject,previousSubjects.get(subject.subject_id),cameraMotion);subject.observed_motion=motion.observed;subject.world_motion=motion.compensated;previousSubjects.set(subject.subject_id,{box:[...subject.box],time})
      const surfaceEvent=surfaces.updateRelation(subject,time);if(surfaceEvent){frameEvents.push(surfaceEvent);semanticEvents.push(surfaceEvent)}
      if(animalPoseEnabled&&frameIndex%2===0){try{const points=await deepPoseFor(subject.box),poseState=posture.update(subject.subject_id,points.map(point=>point.local||point),time);subject.pose={keypoints:points,candidate:poseState.candidate,confidence:poseState.confidence,stable:poseState.stable};poseFrames++;if(poseState.transition){const action={standing:'standing_up',sitting:'sitting_down',lying:'lying_down',crouching:'crouching'}[poseState.transition.current]||'other',event={id:`posture_${subject.subject_id}_${frameIndex}`,start:poseState.transition.start,end:poseState.transition.end,actor:subject.subject_id,action,confidence:poseState.transition.confidence,importance:.72,description:`${subject.subject_id} changes posture from ${poseState.transition.previous} to ${poseState.transition.current}.`,source:'posture-v3'};frameEvents.push(event);semanticEvents.push(event)}}catch{}}
    }
    const stableDogs=subjects.filter(item=>item.label==='dog'&&item.subject_id),people=subjects.filter(item=>item.label==='person'),relations=[]
    for(let first=0;first<stableDogs.length;first++)for(let second=first+1;second<stableDogs.length;second++){const gap=distance(stableDogs[first],stableDogs[second]);relations.push({type:'dog_dog',first:stableDogs[first].subject_id,second:stableDogs[second].subject_id,distance:gap,changed:false})}
    for(const dog of stableDogs)for(const person of people){const gap=distance(dog,person);relations.push({type:'person_dog',first:dog.subject_id,second:person.subject_id,distance:gap,changed:gap<.25})}
    let hands=[];if(handLandmarker&&stableDogs.length&&people.length&&relations.some(item=>item.type==='person_dog'&&item.distance<.38)){try{const result=handLandmarker.detectForVideo(capture,time*1000);hands=(result.landmarks||[]).map(points=>points.map(point=>({x:point.x,y:point.y,z:point.z})))}catch{}}
    for(const dog of stableDogs){const contact=hands.some(points=>points.some(point=>point.x>=dog.box[0]-.04&&point.x<=dog.box[2]+.04&&point.y>=dog.box[1]-.04&&point.y<=dog.box[3]+.04));if(contact)relations.push({type:'hand_dog',first:dog.subject_id,second:'person_1',distance:0,changed:true})}
    const objectCandidates=subjects.filter(item=>dogInterestLabels.has(item.label)).map(item=>{if(!objectFirstSeen.has(item.track_id))objectFirstSeen.set(item.track_id,time);const mouthProximity=stableDogs.some(dog=>dog.pose?.keypoints?.[2]&&pointBoxDistance(dog.pose.keypoints[2],item.box)<.065);return {track_id:item.track_id,label:item.label,box:item.box,confidence:item.score,new:time-objectFirstSeen.get(item.track_id)<.5,mouth_proximity:mouthProximity}})
    const observation={time:Number(time.toFixed(3)),camera_motion:cameraMotion,subjects:subjects.map(item=>({track_id:item.track_id,subject_id:item.subject_id,label:item.label,box:item.box,confidence:item.score,reid_score:item.reid_score,reid_components:item.reid_components,identity_decision:item.identity_decision,observed_motion:item.observed_motion,world_motion:item.world_motion,pose:item.pose?{keypoints:item.pose.keypoints,candidate:item.pose.candidate,confidence:item.pose.confidence,stable:item.pose.stable}:null})),hands,relations,object_candidates:objectCandidates,events:frameEvents,image:deepThumbnail(),identity_decisions:subjects.filter(item=>item.label==='dog').map(item=>({track_id:item.track_id,subject_id:item.subject_id,identity_decision:item.identity_decision}))}
    observations.push(observation);deepDebugRecorder.recordObservation({...observation,image:undefined});if(frameIndex%3===0){draw(subjects.filter(item=>item.subject_id).map((item,index)=>({...item,id:Number(item.subject_id?.split('_')[1])||index+1,subjectNumber:Number(item.subject_id?.split('_')[1])||index+1,color:categoryPalettes[category(item.label)][index%categoryPalettes[category(item.label)].length],missed:0,evidenceFrames:3})));setDeepProgress(t('deepPassA'),frameIndex+1,totalFrames,`${time.toFixed(1)}s / ${duration.toFixed(1)}s · ${identity.subjects.size} persistent dogs`);await new Promise(resolve=>requestAnimationFrame(resolve))}
  }
  deepDebugRecorder.pass_a.effective_detector_fps=sampleFps;deepDebugRecorder.pass_a.pose_frames=poseFrames;deepDebugRecorder.camera_motion_metrics.mean_confidence=deepDebugRecorder.camera_motion_metrics.frames?cameraConfidenceSum/deepDebugRecorder.camera_motion_metrics.frames:0;deepDebugRecorder.identity_metrics.persistent_subjects=identity.subjects.size;deepDebugRecorder.surface_entities=surfaces.snapshot()
  setDeepProgress(t('deepPassB'),0,1,`${observations.length} observations`);const candidates=generateCandidateIntervals(observations,duration);deepDebugRecorder.candidate_intervals=candidates;setDeepProgress(t('deepPassB'),1,1,`${candidates.length} merged intervals`)
  for(let index=0;index<candidates.length;index++){
    if(token!==deepAnalysisToken)return;const candidate=candidates[index]
    try{const sequence=await deepContactSheet(candidate,observations),knownSubjects=[...identity.subjects.keys(),'person_1'],response=await fetch('/api/deep/analyse-window',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language,interval:candidate,sequence,knownSubjects,context:currentContextPayload()})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Deep semantic window failed');deepDebugRecorder.recordVision(result);semanticEvents.push(...(result.events||[]));setDeepProgress(t('deepPassC'),index+1,candidates.length,`${candidate.start.toFixed(1)}–${candidate.end.toFixed(1)}s · ${(result.events||[]).length} events`)}catch(error){deepDebugRecorder.vision_metrics.discarded_responses++;deepDebugRecorder.dropped_events.push({status:'rejected',stage:'window_request',interval:{start:candidate.start,end:candidate.end},reason:String(error.message||error)});setDeepProgress(t('deepPassC'),index+1,candidates.length,`${candidate.start.toFixed(1)}–${candidate.end.toFixed(1)}s · review unavailable`)}
  }
  deepDebugRecorder.semantic_events_before_reconciliation=semanticEvents;const local=reconcileV3Events(semanticEvents,{sessionDuration:duration,maxEvents:12});setDeepProgress(t('deepPassD'),0,1,`${local.events.length} events to reconcile`)
  const finalResponse=await fetch('/api/deep/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language,sessionDuration:duration,events:local.events,context:currentContextPayload(),identity:identity.snapshot(),surfaces:surfaces.snapshot(),candidates})}),finalResult=await finalResponse.json();if(!finalResponse.ok)throw new Error(finalResult.error||'Deep final reconciliation failed')
  deepFinalResult=finalResult;deepAnalysisComplete=true;deepDebugRecorder.finalize({events:finalResult.events,story:finalResult.story,summary:finalResult.summary,surfaces:surfaces.snapshot()});deepDebugRecorder.identity_metrics.persistent_subjects=identity.subjects.size;deepDebugRecorder.surface_reconciliation=finalResult.surface_reconciliation||[];setDeepProgress(t('deepPassD'),1,1,t('deepComplete'));statusText.textContent=t('deepComplete');statusDot.className='ready'
  for(const event of finalResult.story||[])addEvent(semanticActionTitle(event.action),`${event.description} · ${Math.round(event.confidence*100)}%`,`deep-v3:${event.id}`,[],0)
  sessionSummaryButton.hidden=false;sessionSummaryText.textContent=finalResult.summary||fallbackV2Narrative(finalResult.events||[]);renderDeepSessionFacts(finalResult.events||[]);sessionModal.hidden=false
  setTimeout(()=>{if(token===deepAnalysisToken)deepProgress.hidden=true},1600);await seekDeepVideo(0);video.controls=true;video.play().catch(()=>{})
}

function renderDeepSessionFacts(events){const metrics=deepDebugRecorder?.vision_metrics||{},facts=[`${deepDebugRecorder?.pass_a.frames_processed||0} ${t('rawObservations')}`,`${events.length} ${t('behaviourEvents')}`,`${deepDebugRecorder?.identity_metrics.persistent_subjects||0} persistent dogs`,`${metrics.structured_events_created||0} structured VisionPsy events`];sessionSummaryFacts.replaceChildren(...facts.map(text=>Object.assign(document.createElement('span'),{textContent:text})))}

async function startDeepRecordedSource(kind,title=''){
  resetSession();showSource(kind,title);emptyState.style.display='none';currentSource.analysisMode='recorded_deep_v3';debugRecorder.source=currentSource
  try{await runDeepRecordedAnalysis()}catch(error){if(String(error.message||error).includes('cancel'))return;deepProgress.hidden=true;statusDot.className='error';statusText.textContent=`${t('deepFailed')}: ${String(error.message||error).slice(0,90)}`;deepDebugRecorder?.dropped_events.push({status:'error',reason:String(error.message||error)})}
}

function resetSession(){tracks=[];retiredTracks=[];nextTrackId=1;subjectCounters.clear();categoryColorCounters.clear();events.length=0;sessionEvents.length=0;sessionContext.clear();sessionMaxVisible.clear();sessionSummaryButton.hidden=true;eventLastSeen.clear();timeline.replaceChildren();lastInterpretationAt=0;semanticFrames.splice(0);lastSemanticSampleAt=0;faceCues=[];handCues=[];handDogContact.clear();nextFaceCueAt=0;nextHandCueAt=0;nextAnimalPoseAt=0;lastFinalResult=null;deepAnalysisComplete=false;deepFinalResult=null;deepDebugRecorder=null;narrativeVersion.textContent='VISIONPSY · NARRATIVE V2';resetNarrativeV2();clearSceneHistory();sceneText.textContent='—'}
async function startLoop(){running=true;emptyState.style.display='none';if(!timer)timer=setInterval(analyse,260)}
async function startCamera(){
  try{stopCurrentSource();const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});video.srcObject=stream;await video.play();resetSession();showSource('camera');startLoop()}
  catch(error){statusDot.className='error';statusText.textContent=t('cameraError');setScene(String(error.message||error),[],{reset:true,immediate:true})}
}
async function openVideo(file){
  if(!file)return
  stopCurrentSource();objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.loop=false;video.muted=true;video.load();if(video.readyState<1)await waitForVideoEvent('loadedmetadata');await startDeepRecordedSource('file',file.name)
}
async function openYoutube(url){
  youtubeError.hidden=true;youtubeSubmit.disabled=true;youtubeSubmit.textContent=t('preparingYoutube')
  try{
    const response=await fetch('/api/youtube/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})})
    const result=await response.json()
    if(!response.ok)throw new Error(result.error||t('invalidYoutube'))
    stopCurrentSource();video.src=result.mediaUrl;video.loop=false;video.muted=true;video.load();if(video.readyState<1)await waitForVideoEvent('loadedmetadata');youtubeModal.hidden=true;await startDeepRecordedSource('youtube',result.title)
  }catch(error){youtubeError.textContent=String(error.message||error);youtubeError.hidden=false}
  finally{youtubeSubmit.disabled=false;youtubeSubmit.textContent=t('analyseUrl')}
}
function applyLanguage(){
  const changed=language!==languageSelect.value
  language=languageSelect.value;document.documentElement.lang=language
  if(changed){events.length=0;eventLastSeen.clear();lastInterpretationAt=0;clearSceneHistory()}
  document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)})
  if(currentSource)showSource(currentSource.kind,currentSource.title)
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
youtubeButton.addEventListener('click',()=>{youtubeError.hidden=true;youtubeModal.hidden=false;requestAnimationFrame(()=>youtubeInput.focus())})
youtubeForm.addEventListener('submit',event=>{event.preventDefault();openYoutube(youtubeInput.value.trim())})
closeYoutubeModal.addEventListener('click',()=>youtubeModal.hidden=true)
youtubeModal.addEventListener('click',event=>{if(event.target===youtubeModal)youtubeModal.hidden=true})
video.addEventListener('ended',()=>{running=false;if(timer){clearInterval(timer);timer=null}if(deepAnalysisComplete&&deepFinalResult){sessionSummaryText.textContent=deepFinalResult.summary||fallbackV2Narrative(deepFinalResult.events||[]);renderDeepSessionFacts(deepFinalResult.events||[]);sessionModal.hidden=false}else showSessionSummary({finalPass:true})})
sessionSummaryButton.addEventListener('click',()=>{if(deepAnalysisComplete&&deepFinalResult){sessionSummaryText.textContent=deepFinalResult.summary||fallbackV2Narrative(deepFinalResult.events||[]);renderDeepSessionFacts(deepFinalResult.events||[]);sessionModal.hidden=false}else showSessionSummary({finalPass:false})})
exportDebugButton.addEventListener('click',()=>deepDebugRecorder&&currentSource?.analysisMode==='recorded_deep_v3'?deepDebugRecorder.download():debugRecorder.download())
closeSessionModal.addEventListener('click',()=>sessionModal.hidden=true)
sessionModal.addEventListener('click',event=>{if(event.target===sessionModal)sessionModal.hidden=true})
languageSelect.addEventListener('change',applyLanguage)
overlayToggle.addEventListener('change',()=>draw(tracks.filter(track=>track.missed===0)))
window.addEventListener('resize',()=>draw(tracks.filter(track=>track.missed===0)))
applyLanguage();refreshStatus();initFaceCues();initHandCues()
