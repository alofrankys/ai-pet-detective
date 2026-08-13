const video=document.getElementById('camera')
const freezeCanvas=document.getElementById('momentFreeze')
const freezeContext=freezeCanvas.getContext('2d')
const emptyState=document.getElementById('emptyState')
const startButton=document.getElementById('startButton')
const fileButton=document.getElementById('fileButton')
const videoFile=document.getElementById('videoFile')
const sourceBadge=document.getElementById('sourceBadge')
const languageSelect=document.getElementById('languageSelect')
const statusDot=document.getElementById('statusDot')
const statusText=document.getElementById('statusText')
const momentGuide=document.getElementById('momentGuide')
const analyseButton=document.getElementById('momentAnalyseButton')
const analysing=document.getElementById('momentAnalysing')
const resultCard=document.getElementById('momentResult')
const resultLabel=document.getElementById('momentResultLabel')
const answer=document.getElementById('momentAnswer')
const modelName=document.getElementById('momentModel')
const localStatus=document.getElementById('momentLocalStatus')
const inferenceTime=document.getElementById('momentInferenceTime')
const tryAgainButton=document.getElementById('momentTryAgainButton')
const presetButtons=[...document.querySelectorAll('[data-moment-preset]')]

const copy={
  en:{
    language:'Language',engineStarting:'VisionPsy starting…',engineReady:'VisionPsy · local',engineUnavailable:'VisionPsy unavailable',
    heroTitle:'One frame. One clear fact.',heroCopy:'Use the camera or open a video, then choose the exact moment.',startCamera:'Start camera',openVideo:'Open video',
    momentIntro:'Choose a clear frame. VisionPsy will inspect this image only.',momentGuide:'Aim the camera or pause your video on the moment you want to inspect.',momentGuideReady:'Choose the clearest moment, then freeze exactly this frame.',
    momentDescribe:'Describe',momentObjects:'Objects',momentSpatial:'Spatial',momentAnalyse:'Analyse this moment',momentLooking:'VisionPsy is looking…',momentOneFrame:'One frozen frame · one local request',
    momentSees:'VISIONPSY SEES',momentLocal:'Local · offline',momentTryAgain:'Try another moment',momentUnclear:'Unclear frame — try another moment',momentError:'VisionPsy is unavailable — check the local engine and try again.',
    cameraSource:'Camera',fileSource:'Uploaded video',cameraError:'Camera unavailable',videoError:'This video cannot be opened in the browser.',privacyNote:'Frame processed locally. No cloud upload.'
  },
  it:{
    language:'Lingua',engineStarting:'Avvio di VisionPsy…',engineReady:'VisionPsy · locale',engineUnavailable:'VisionPsy non disponibile',
    heroTitle:'Un fotogramma. Un fatto chiaro.',heroCopy:'Usa la fotocamera o apri un video, poi scegli il momento esatto.',startCamera:'Avvia fotocamera',openVideo:'Apri video',
    momentIntro:'Scegli un fotogramma chiaro. VisionPsy analizzerà soltanto questa immagine.',momentGuide:'Inquadra con la fotocamera o metti in pausa il video nel momento da osservare.',momentGuideReady:'Scegli il momento più chiaro, poi congela esattamente questo fotogramma.',
    momentDescribe:'Descrivi',momentObjects:'Oggetti',momentSpatial:'Spaziale',momentAnalyse:'Analizza questo momento',momentLooking:'VisionPsy sta osservando…',momentOneFrame:'Un fotogramma congelato · una richiesta locale',
    momentSees:'VISIONPSY VEDE',momentLocal:'Locale · offline',momentTryAgain:'Prova un altro momento',momentUnclear:'Fotogramma poco chiaro — prova un altro momento',momentError:'VisionPsy non è disponibile — controlla il motore locale e riprova.',
    cameraSource:'Fotocamera',fileSource:'Video caricato',cameraError:'Fotocamera non disponibile',videoError:'Questo video non può essere aperto nel browser.',privacyNote:'Fotogramma elaborato localmente. Nessun caricamento sul cloud.'
  }
}

let language='en'
let preset='describe'
let currentSource=null
let objectUrl=null
let sourceReady=false
let busy=false
let requestToken=0
let resumeAfterTry=false
let statusTimer=null

function t(key){return copy[language][key]||copy.en[key]||key}

function fitDimensions(width,height,longEdge=1280){
  const sourceWidth=Math.max(1,Number(width)||1)
  const sourceHeight=Math.max(1,Number(height)||1)
  const scale=Math.min(1,longEdge/Math.max(sourceWidth,sourceHeight))
  return {width:Math.max(1,Math.round(sourceWidth*scale)),height:Math.max(1,Math.round(sourceHeight*scale))}
}

function waitForVideoEvent(name,timeout=12_000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error(`video ${name} timeout`))},timeout)
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener(name,onEvent);video.removeEventListener('error',onError)}
    const onEvent=()=>{cleanup();resolve()}
    const onError=()=>{cleanup();reject(new Error(video.error?.message||'video error'))}
    video.addEventListener(name,onEvent,{once:true})
    video.addEventListener('error',onError,{once:true})
  })
}

function setControlsDisabled(disabled){
  startButton.disabled=disabled
  fileButton.disabled=disabled
  presetButtons.forEach(button=>button.disabled=disabled)
  analyseButton.disabled=disabled||!sourceReady
}

function showSource(kind,title=''){
  currentSource={kind,title:String(title||'').trim()}
  const prefix=kind==='camera'?t('cameraSource'):t('fileSource')
  sourceBadge.textContent=currentSource.title?`${prefix} · ${currentSource.title}`:prefix
  sourceBadge.hidden=false
  sourceReady=true
  emptyState.hidden=true
  momentGuide.textContent=t('momentGuideReady')
  momentGuide.classList.add('ready')
  setControlsDisabled(false)
}

function resetResult({hideFreeze=true}={}){
  analysing.hidden=true
  resultCard.hidden=true
  resultCard.classList.remove('unclear','error')
  resultLabel.textContent=t('momentSees')
  answer.textContent=''
  modelName.textContent='VisionPsy-Nano-460M-Flash'
  localStatus.textContent=t('momentLocal')
  inferenceTime.textContent='— ms'
  analyseButton.hidden=false
  if(hideFreeze)freezeCanvas.classList.remove('visible')
}

function stopCurrentSource(){
  requestToken++
  busy=false
  resumeAfterTry=false
  if(video.srcObject){video.srcObject.getTracks().forEach(track=>track.stop());video.srcObject=null}
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
  video.pause()
  video.controls=false
  video.removeAttribute('src')
  video.load()
  currentSource=null
  sourceReady=false
  sourceBadge.hidden=true
  emptyState.hidden=false
  momentGuide.textContent=t('momentGuide')
  momentGuide.classList.remove('ready')
  resetResult()
  setControlsDisabled(false)
}

async function startCamera(){
  stopCurrentSource()
  setControlsDisabled(true)
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:'environment'}},audio:false})
    video.srcObject=stream
    video.controls=false
    await video.play()
    showSource('camera')
  }catch{
    statusDot.className='error'
    statusText.textContent=t('cameraError')
    setControlsDisabled(false)
  }
}

async function openVideo(file){
  if(!file)return
  stopCurrentSource()
  setControlsDisabled(true)
  try{
    objectUrl=URL.createObjectURL(file)
    video.src=objectUrl
    video.loop=false
    video.muted=true
    video.controls=true
    video.load()
    if(video.readyState<1)await waitForVideoEvent('loadedmetadata')
    if(video.readyState<2)await waitForVideoEvent('loadeddata')
    showSource('file',file.name)
    video.play().catch(()=>{})
  }catch{
    stopCurrentSource()
    momentGuide.textContent=t('videoError')
  }
}

function frozenJpeg(){
  const dimensions=fitDimensions(video.videoWidth,video.videoHeight)
  freezeCanvas.width=dimensions.width
  freezeCanvas.height=dimensions.height
  freezeContext.drawImage(video,0,0,dimensions.width,dimensions.height)
  return new Promise(resolve=>freezeCanvas.toBlob(resolve,'image/jpeg',.9))
}

function formatInferenceTime(value){
  const milliseconds=Number(value)
  if(!Number.isFinite(milliseconds))return '— ms'
  return milliseconds<1000?`${Math.round(milliseconds)} ms`:`${(milliseconds/1000).toFixed(2)} s`
}

function showResult(result){
  const clear=result.status==='clear'&&typeof result.answer==='string'&&result.answer.trim()
  answer.textContent=clear?result.answer:t('momentUnclear')
  resultCard.classList.toggle('unclear',!clear)
  resultCard.classList.remove('error')
  modelName.textContent=String(result.model||'VisionPsy-Nano-460M-Flash')
  localStatus.textContent=t('momentLocal')
  inferenceTime.textContent=formatInferenceTime(result.inference_ms)
  resultCard.hidden=false
}

function showEngineError(){
  answer.textContent=t('momentError')
  resultCard.classList.remove('unclear')
  resultCard.classList.add('error')
  modelName.textContent='VisionPsy-Nano-460M-Flash'
  localStatus.textContent=t('engineUnavailable')
  inferenceTime.textContent='— ms'
  resultCard.hidden=false
}

async function analyseCurrentMoment(){
  if(busy||!sourceReady||video.readyState<2||!video.videoWidth||!video.videoHeight)return
  const token=++requestToken
  busy=true
  resumeAfterTry=currentSource?.kind==='file'&&!video.paused
  if(currentSource?.kind==='file')video.pause()
  analyseButton.hidden=true
  analysing.hidden=false
  resultCard.hidden=true
  setControlsDisabled(true)
  try{
    const jpeg=await frozenJpeg()
    if(!jpeg)throw new Error('Could not freeze this frame')
    freezeCanvas.classList.add('visible')
    const response=await fetch('/api/moment-lens',{method:'POST',headers:{'content-type':'image/jpeg','x-moment-preset':preset},body:jpeg})
    const result=await response.json()
    if(!response.ok)throw new Error(result.error||`Moment Lens ${response.status}`)
    if(token===requestToken)showResult(result)
  }catch{
    if(token===requestToken)showEngineError()
  }finally{
    if(token===requestToken){busy=false;analysing.hidden=true;setControlsDisabled(false)}
  }
}

function tryAnotherMoment(){
  if(!sourceReady)return
  requestToken++
  const shouldResume=resumeAfterTry
  busy=false
  resumeAfterTry=false
  resetResult()
  setControlsDisabled(false)
  if(shouldResume&&currentSource?.kind==='file')video.play().catch(()=>{})
}

function applyLanguage(){
  language=languageSelect.value==='it'?'it':'en'
  document.documentElement.lang=language
  document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)})
  if(currentSource)showSource(currentSource.kind,currentSource.title)
  else{momentGuide.textContent=t('momentGuide');momentGuide.classList.remove('ready')}
  localStatus.textContent=t('momentLocal')
  setControlsDisabled(busy)
}

async function refreshStatus(){
  try{
    const status=await fetch('/api/status').then(response=>response.json())
    if(status.visionpsy?.enabled){statusDot.className='ready';statusText.textContent=t('engineReady')}
    else{statusDot.className='starting';statusText.textContent=t('engineStarting')}
  }catch{statusDot.className='error';statusText.textContent=t('engineUnavailable')}
}

presetButtons.forEach(button=>button.addEventListener('click',()=>{
  if(busy)return
  preset=button.dataset.momentPreset
  presetButtons.forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))})
}))
startButton.addEventListener('click',startCamera)
fileButton.addEventListener('click',()=>{videoFile.value='';videoFile.click()})
videoFile.addEventListener('change',()=>openVideo(videoFile.files[0]))
analyseButton.addEventListener('click',analyseCurrentMoment)
tryAgainButton.addEventListener('click',tryAnotherMoment)
languageSelect.addEventListener('change',applyLanguage)
video.addEventListener('play',()=>{if(!busy&&freezeCanvas.classList.contains('visible'))tryAnotherMoment()})
window.addEventListener('pagehide',()=>{clearInterval(statusTimer);stopCurrentSource()})

applyLanguage()
refreshStatus()
statusTimer=setInterval(refreshStatus,10_000)
