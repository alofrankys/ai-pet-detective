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
const analysingTitle=document.getElementById('momentAnalysingTitle')
const comparisonResults=document.getElementById('comparisonResults')
const tryAgainButton=document.getElementById('momentTryAgainButton')
const presetButtons=[...document.querySelectorAll('[data-moment-preset]')]

const modelElements=Object.freeze({
  flash:{
    card:document.getElementById('flashCard'),
    state:document.getElementById('flashState'),
    answer:document.getElementById('flashAnswer'),
    inference:document.getElementById('flashInferenceTime')
  },
  quality:{
    card:document.getElementById('qualityCard'),
    state:document.getElementById('qualityState'),
    answer:document.getElementById('qualityAnswer'),
    inference:document.getElementById('qualityInferenceTime')
  }
})

const copy={
  en:{
    language:'UI language',engineStarting:'Starting Q4 models',engineReady:'2 Q4 models · local',engineUnavailable:'VisionPsy models unavailable',
    heroTitle:'One frame. Two visual paths.',heroCopy:'Choose one exact moment and compare both local VisionPsy models.',startCamera:'Start camera',openVideo:'Open video',
    momentIntro:'Freeze one clear frame. Flash and Full inspect the exact same image with the exact same prompt.',momentGuide:'Aim the camera or pause your video on the moment you want to inspect.',momentGuideReady:'Choose the clearest moment, then compare exactly this frame.',
    momentDescribe:'Describe',momentObjects:'Objects',momentSpatial:'Spatial',momentAnalyse:'Compare this moment',momentLooking:'Flash is looking…',momentOneFrame:'Full follows on the same frozen frame',
    momentSees:'VISIONPSY SEES',momentLocal:'Local · offline',momentTryAgain:'Compare another moment',momentUnclear:'Unclear frame — try another moment',momentError:'This model could not analyse the frame.',
    speedPath:'FLASH VISUAL PATH',qualityPath:'FULL VISUAL PATH',modelWaiting:'Waiting',modelQueued:'Queued',modelRunning:'Analysing',modelReady:'Ready',modelUnclear:'Unclear',modelError:'Unavailable',
    flashLooking:'Flash is looking…',qualityLooking:'Full is looking…',cameraSource:'Camera',fileSource:'Uploaded video',cameraError:'Camera unavailable',videoError:'This video cannot be opened in the browser.',
    privacyNote:'Same frozen frame · Same prompt · Q4_K_M weights · 100% local.'
  },
  it:{
    language:'Lingua UI',engineStarting:'Avvio modelli Q4',engineReady:'2 modelli Q4 · locali',engineUnavailable:'Modelli VisionPsy non disponibili',
    heroTitle:'Un fotogramma. Due percorsi visivi.',heroCopy:'Scegli un momento esatto e confronta entrambi i modelli VisionPsy locali.',startCamera:'Avvia fotocamera',openVideo:'Apri video',
    momentIntro:'Congela un fotogramma chiaro. Flash e Full osservano esattamente la stessa immagine con lo stesso prompt.',momentGuide:'Inquadra con la fotocamera o metti in pausa il video nel momento da osservare.',momentGuideReady:'Scegli il momento più chiaro, poi confronta esattamente questo fotogramma.',
    momentDescribe:'Descrivi',momentObjects:'Oggetti',momentSpatial:'Spaziale',momentAnalyse:'Confronta questo momento',momentLooking:'Flash sta osservando…',momentOneFrame:'Full seguirà sullo stesso fotogramma',
    momentSees:'VISIONPSY VEDE',momentLocal:'Locale · offline',momentTryAgain:'Confronta un altro momento',momentUnclear:'Fotogramma poco chiaro — prova un altro momento',momentError:'Questo modello non ha potuto analizzare il fotogramma.',
    speedPath:'PERCORSO VISIVO FLASH',qualityPath:'PERCORSO VISIVO FULL',modelWaiting:'In attesa',modelQueued:'In coda',modelRunning:'Analisi',modelReady:'Pronto',modelUnclear:'Poco chiaro',modelError:'Non disponibile',
    flashLooking:'Flash sta osservando…',qualityLooking:'Full sta osservando…',cameraSource:'Fotocamera',fileSource:'Video caricato',cameraError:'Fotocamera non disponibile',videoError:'Questo video non può essere aperto nel browser.',
    privacyNote:'Stesso fotogramma · Stesso prompt · Pesi Q4_K_M · 100% locale.'
  }
}

let language='en'
let preset='describe'
let currentSource=null
let objectUrl=null
let sourceReady=false
let sourceLoading=false
let modelsReady=false
let busy=false
let requestToken=0
let resumeAfterTry=false
let statusTimer=null
let activeController=null
let runtimeState='starting'
let readyModelCount=0
const modelViews={flash:{phase:'waiting',result:null},quality:{phase:'waiting',result:null}}

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

function renderRuntimeStatus(){
  statusDot.className=runtimeState==='ready'?'ready':runtimeState==='error'?'error':'starting'
  statusText.textContent=runtimeState==='ready'?t('engineReady'):runtimeState==='error'?t('engineUnavailable'):`${t('engineStarting')} · ${readyModelCount}/2`
}

function setControlsDisabled(){
  const sourceLocked=busy||sourceLoading
  startButton.disabled=sourceLocked
  fileButton.disabled=sourceLocked
  presetButtons.forEach(button=>button.disabled=busy)
  analyseButton.disabled=busy||!sourceReady||!modelsReady
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
  setControlsDisabled()
}

function formatInferenceTime(value){
  if(value===null||value===undefined||value==='')return '— ms'
  const milliseconds=Number(value)
  if(!Number.isFinite(milliseconds))return '— ms'
  return milliseconds<1000?`${Math.round(milliseconds)} ms`:`${(milliseconds/1000).toFixed(2)} s`
}

function safeVisibleAnswer(result){
  if(result?.status!=='clear'||typeof result.answer!=='string')return null
  const value=result.answer.replace(/\s+/g,' ').trim()
  if(!value||value.length>320||value.split(/\s+/).length>45)return null
  if(/^UNCLEAR[.!]?$/i.test(value))return null
  if(/```|[{}\[\]]|"?(?:events?|actor_ref|target_ref|action|confidence|evidence|context|model_?output)"?\s*[:=]|^\s*(?:json|schema|template|output)\s*(?::|=|-|—)|\b(?:use one short factual sentence|answer unclear|example json|schema|template)\b|\b[a-z_]{3,}\s*\|\s*[a-z_]{3,}\b/i.test(value))return null
  return value
}

function renderModel(variant){
  const elements=modelElements[variant]
  const view=modelViews[variant]
  const safeAnswer=safeVisibleAnswer(view.result)
  let phase=view.phase
  if(phase==='result')phase=safeAnswer?'clear':view.result?.status==='error'?'error':'unclear'
  elements.card.className=`model-result-card ${phase}`
  elements.card.dataset.state=phase
  elements.card.setAttribute('aria-busy',String(phase==='running'))
  const key={waiting:'modelWaiting',queued:'modelQueued',running:'modelRunning',clear:'modelReady',unclear:'modelUnclear',error:'modelError'}[phase]||'modelWaiting'
  elements.state.textContent=t(key)
  elements.answer.textContent=phase==='clear'?safeAnswer:phase==='unclear'?t('momentUnclear'):phase==='error'?t('momentError'):''
  elements.inference.textContent=view.result?formatInferenceTime(view.result.inference_ms):'— ms'
}

function resetComparison({hideFreeze=true}={}){
  analysing.hidden=true
  comparisonResults.hidden=true
  tryAgainButton.hidden=true
  analyseButton.hidden=false
  for(const variant of Object.keys(modelViews)){
    modelViews[variant].phase='waiting'
    modelViews[variant].result=null
    renderModel(variant)
  }
  if(hideFreeze)freezeCanvas.classList.remove('visible')
}

function prepareComparison(){
  modelViews.flash={phase:'queued',result:null}
  modelViews.quality={phase:'queued',result:null}
  renderModel('flash')
  renderModel('quality')
  comparisonResults.hidden=false
  tryAgainButton.hidden=true
  analysingTitle.textContent=t('flashLooking')
  analysing.hidden=false
}

function stopCurrentSource(){
  requestToken++
  activeController?.abort()
  activeController=null
  busy=false
  sourceLoading=false
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
  resetComparison()
  setControlsDisabled()
}

async function startCamera(){
  stopCurrentSource()
  sourceLoading=true
  setControlsDisabled()
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:'environment'}},audio:false})
    video.srcObject=stream
    video.controls=false
    await video.play()
    showSource('camera')
  }catch{
    momentGuide.textContent=t('cameraError')
  }finally{
    sourceLoading=false
    setControlsDisabled()
  }
}

async function openVideo(file){
  if(!file)return
  stopCurrentSource()
  sourceLoading=true
  setControlsDisabled()
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
  }finally{
    sourceLoading=false
    setControlsDisabled()
  }
}

function frozenJpeg(){
  const dimensions=fitDimensions(video.videoWidth,video.videoHeight)
  freezeCanvas.width=dimensions.width
  freezeCanvas.height=dimensions.height
  freezeContext.drawImage(video,0,0,dimensions.width,dimensions.height)
  return new Promise(resolve=>freezeCanvas.toBlob(resolve,'image/jpeg',.9))
}

function handleComparisonEvent(event){
  if(!event||typeof event!=='object')return false
  if(event.type==='model-start'&&Object.hasOwn(modelViews,event.variant)){
    modelViews[event.variant].phase='running'
    renderModel(event.variant)
    analysingTitle.textContent=event.variant==='quality'?t('qualityLooking'):t('flashLooking')
  }
  if(event.type==='model-result'&&Object.hasOwn(modelViews,event.result?.variant)){
    const variant=event.result.variant
    modelViews[variant].phase='result'
    modelViews[variant].result=event.result
    renderModel(variant)
  }
  if(event.type==='comparison-complete')return true
  if(event.type==='comparison-error')throw new Error('comparison failed')
  return false
}

async function readComparisonStream(response){
  if(!response.ok)throw new Error(`Moment Lens ${response.status}`)
  if(!response.body)throw new Error('Streaming response unavailable')
  const reader=response.body.getReader()
  const decoder=new TextDecoder()
  let buffer=''
  let complete=false
  while(true){
    const {done,value}=await reader.read()
    buffer+=decoder.decode(value||new Uint8Array(),{stream:!done})
    const lines=buffer.split('\n')
    buffer=lines.pop()||''
    for(const line of lines){
      if(!line.trim())continue
      complete=handleComparisonEvent(JSON.parse(line))||complete
    }
    if(done)break
  }
  if(buffer.trim())complete=handleComparisonEvent(JSON.parse(buffer))||complete
  return complete
}

function markIncompleteModelsAsError(){
  for(const variant of Object.keys(modelViews)){
    if(!['result'].includes(modelViews[variant].phase)){
      modelViews[variant].phase='result'
      modelViews[variant].result={variant,status:'error',answer:null,inference_ms:null}
      renderModel(variant)
    }
  }
}

async function analyseCurrentMoment(){
  if(busy||!modelsReady||!sourceReady||video.readyState<2||!video.videoWidth||!video.videoHeight)return
  const token=++requestToken
  busy=true
  activeController=new AbortController()
  resumeAfterTry=currentSource?.kind==='file'&&!video.paused
  if(currentSource?.kind==='file')video.pause()
  analyseButton.hidden=true
  prepareComparison()
  setControlsDisabled()
  try{
    const jpeg=await frozenJpeg()
    if(!jpeg)throw new Error('Could not freeze this frame')
    freezeCanvas.classList.add('visible')
    const response=await fetch('/api/moment-lens',{method:'POST',headers:{'content-type':'image/jpeg','x-moment-preset':preset},body:jpeg,signal:activeController.signal})
    const complete=await readComparisonStream(response)
    if(!complete)throw new Error('Comparison ended early')
  }catch{
    if(token===requestToken)markIncompleteModelsAsError()
  }finally{
    if(token===requestToken){
      activeController=null
      busy=false
      analysing.hidden=true
      comparisonResults.hidden=false
      tryAgainButton.hidden=false
      setControlsDisabled()
    }
  }
}

function tryAnotherMoment(){
  if(!sourceReady)return
  requestToken++
  activeController?.abort()
  activeController=null
  const shouldResume=resumeAfterTry
  busy=false
  resumeAfterTry=false
  resetComparison()
  setControlsDisabled()
  if(shouldResume&&currentSource?.kind==='file')video.play().catch(()=>{})
}

function applyLanguage(){
  language=languageSelect.value==='it'?'it':'en'
  document.documentElement.lang=language
  document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)})
  if(currentSource)showSource(currentSource.kind,currentSource.title)
  else if(!sourceLoading){momentGuide.textContent=t('momentGuide');momentGuide.classList.remove('ready')}
  if(busy)analysingTitle.textContent=modelViews.quality.phase==='running'?t('qualityLooking'):t('flashLooking')
  renderModel('flash')
  renderModel('quality')
  renderRuntimeStatus()
  setControlsDisabled()
}

async function refreshStatus(){
  try{
    const response=await fetch('/api/status',{cache:'no-store'})
    const status=await response.json()
    const models=Array.isArray(status.models)?status.models:[]
    readyModelCount=models.filter(model=>model?.ready).length
    modelsReady=status.comparison_ready===true&&readyModelCount===2
    const terminalFailure=models.some(model=>['models_missing','runtime_missing','wrong_model'].includes(model?.reason))
    runtimeState=modelsReady?'ready':terminalFailure?'error':'starting'
  }catch{
    modelsReady=false
    readyModelCount=0
    runtimeState='error'
  }
  renderRuntimeStatus()
  setControlsDisabled()
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
statusTimer=setInterval(refreshStatus,5_000)
