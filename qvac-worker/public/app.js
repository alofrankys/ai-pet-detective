import {
  createObjectUrlLease,
  createPhotoSelection,
  movePhotoIndex,
  photoCounter,
  selectPhotoIndex
} from './photo-selection.js'

const video=document.getElementById('camera')
const photoPreview=document.getElementById('photoPreview')
const freezeCanvas=document.getElementById('momentFreeze')
const freezeContext=freezeCanvas.getContext('2d')
const emptyState=document.getElementById('emptyState')
const startButton=document.getElementById('startButton')
const fileButton=document.getElementById('fileButton')
const videoFile=document.getElementById('videoFile')
const photoButton=document.getElementById('photoButton')
const photoFiles=document.getElementById('photoFiles')
const sourceToolbar=document.getElementById('sourceToolbar')
const switchCameraButton=document.getElementById('switchCameraButton')
const switchVideoButton=document.getElementById('switchVideoButton')
const switchPhotoButton=document.getElementById('switchPhotoButton')
const photoQueue=document.getElementById('photoQueue')
const photoFilmstrip=document.getElementById('photoFilmstrip')
const previousPhoto=document.getElementById('previousPhoto')
const nextPhoto=document.getElementById('nextPhoto')
const photoCounterOutput=document.getElementById('photoCounter')
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
    inference:document.getElementById('flashInferenceTime'),
    outputTokens:document.getElementById('flashOutputTokens')
  },
  quality:{
    card:document.getElementById('qualityCard'),
    state:document.getElementById('qualityState'),
    answer:document.getElementById('qualityAnswer'),
    inference:document.getElementById('qualityInferenceTime'),
    outputTokens:document.getElementById('qualityOutputTokens')
  }
})

const copy={
  en:{
    language:'UI language',engineStarting:'Starting Q4 models',engineReady:'2 Q4 models · local',engineUnavailable:'VisionPsy models unavailable',
    heroTitle:'One image. Two visual paths.',heroCopy:'Use the camera, open a video, or choose one or more photos.',startCamera:'Start camera',openVideo:'Open video',openPhotos:'Open photos',
    momentIntro:'One image and one open prompt. Flash and Full answer in their own words with the same deterministic greedy decode.',momentGuide:'Aim the camera, pause a video, or select a photo to inspect.',momentGuideReady:'Choose the clearest image, then compare exactly this moment.',photoGuideReady:'Only this selected photo will be compared. Other photos stay local in the queue.',
    momentDescribe:'Describe',momentObjects:'Objects',momentSpatial:'Spatial',momentAnalyse:'Compare this moment',momentLooking:'Both models are looking…',momentOneFrame:'Same image · same prompt · simultaneous local inference',
    momentSees:'VISIONPSY SEES',momentLocal:'Local · offline',momentTryAgain:'Compare another moment',momentUnclear:'Unclear image — try another moment',momentError:'This model could not analyse the image.',
    speedPath:'FLASH VISUAL PATH',qualityPath:'FULL VISUAL PATH',modelWaiting:'Waiting',modelQueued:'Queued',modelRunning:'Analysing',modelReady:'Ready',modelLimited:'Max reached',modelUnclear:'Unclear',modelError:'Unavailable',outputTokens:'output tokens',
    flashLooking:'Flash is looking…',qualityLooking:'Full is looking…',cameraSource:'Camera',fileSource:'Uploaded video',photoSource:'Photo',cameraError:'Camera unavailable',videoError:'This video cannot be opened in the browser.',photoError:'These photos cannot be opened. Choose JPEG, PNG, or WebP files.',
    changeSource:'Change source',stageLabel:'Camera, video, or selected photo',selectedPhotos:'Selected photos',photoList:'Photos',momentPromptLabel:'Moment Lens prompt',cameraShort:'Camera',videoShort:'Video',photosShort:'Photos',previousPhoto:'Previous photo',nextPhoto:'Next photo',photoLabel:'Photo',
    privacyNote:'Same selected image · Same prompt · Greedy · 256 max output tokens · Q4_K_M · 100% local.'
  },
  it:{
    language:'Lingua UI',engineStarting:'Avvio modelli Q4',engineReady:'2 modelli Q4 · locali',engineUnavailable:'Modelli VisionPsy non disponibili',
    heroTitle:'Un’immagine. Due percorsi visivi.',heroCopy:'Usa la fotocamera, apri un video oppure scegli una o più foto.',startCamera:'Avvia fotocamera',openVideo:'Apri video',openPhotos:'Apri foto',
    momentIntro:'Un’immagine e un prompt aperto. Flash e Full rispondono con parole proprie usando la stessa decodifica greedy deterministica.',momentGuide:'Inquadra, metti in pausa un video oppure seleziona una foto.',momentGuideReady:'Scegli l’immagine più chiara, poi confronta esattamente questo momento.',photoGuideReady:'Verrà confrontata soltanto questa foto. Le altre restano locali nella coda.',
    momentDescribe:'Descrivi',momentObjects:'Oggetti',momentSpatial:'Spaziale',momentAnalyse:'Confronta questo momento',momentLooking:'Entrambi i modelli stanno osservando…',momentOneFrame:'Stessa immagine · stesso prompt · inferenza locale simultanea',
    momentSees:'VISIONPSY VEDE',momentLocal:'Locale · offline',momentTryAgain:'Confronta un altro momento',momentUnclear:'Immagine poco chiara — prova un altro momento',momentError:'Questo modello non ha potuto analizzare l’immagine.',
    speedPath:'PERCORSO VISIVO FLASH',qualityPath:'PERCORSO VISIVO FULL',modelWaiting:'In attesa',modelQueued:'In coda',modelRunning:'Analisi',modelReady:'Pronto',modelLimited:'Limite raggiunto',modelUnclear:'Poco chiaro',modelError:'Non disponibile',outputTokens:'token di output',
    flashLooking:'Flash sta osservando…',qualityLooking:'Full sta osservando…',cameraSource:'Fotocamera',fileSource:'Video caricato',photoSource:'Foto',cameraError:'Fotocamera non disponibile',videoError:'Questo video non può essere aperto nel browser.',photoError:'Queste foto non possono essere aperte. Scegli file JPEG, PNG o WebP.',
    changeSource:'Cambia sorgente',stageLabel:'Fotocamera, video o foto selezionata',selectedPhotos:'Foto selezionate',photoList:'Foto',momentPromptLabel:'Prompt di Moment Lens',cameraShort:'Fotocamera',videoShort:'Video',photosShort:'Foto',previousPhoto:'Foto precedente',nextPhoto:'Foto successiva',photoLabel:'Foto',
    privacyNote:'Stessa immagine selezionata · Stesso prompt · Greedy · Massimo 256 token di output · Q4_K_M · 100% locale.'
  }
}

let language='en'
let preset='describe'
let currentSource=null
let objectUrl=null
let photoSelection=createPhotoSelection([])
let photoDecodeToken=0
const photoObjectUrl=createObjectUrlLease()
const thumbnailObjectUrls=new Set()
let sourceReady=false
let sourceLoading=false
let modelsReady=false
let busy=false
let requestToken=0
let resumeAfterTry=false
let statusTimer=null
let modelProgressTimer=null
let activeController=null
let runtimeState='starting'
let readyModelCount=0
const modelViews={flash:{phase:'waiting',result:null,startedAt:null},quality:{phase:'waiting',result:null,startedAt:null}}

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
  photoButton.disabled=sourceLocked
  switchCameraButton.disabled=sourceLocked
  switchVideoButton.disabled=sourceLocked
  switchPhotoButton.disabled=sourceLocked
  photoFilmstrip.querySelectorAll('button').forEach(button=>{button.disabled=sourceLocked})
  previousPhoto.disabled=sourceLocked||photoSelection.index<=0
  nextPhoto.disabled=sourceLocked||photoSelection.index>=photoSelection.items.length-1
  presetButtons.forEach(button=>button.disabled=busy)
  analyseButton.disabled=busy||sourceLoading||!sourceReady||!modelsReady
}

function renderSourcePresentation(){
  if(!currentSource)return
  const prefix=currentSource.kind==='camera'?t('cameraSource'):currentSource.kind==='video'?t('fileSource'):t('photoSource')
  sourceBadge.textContent=currentSource.title?`${prefix} · ${currentSource.title}`:prefix
  sourceBadge.hidden=false
  momentGuide.textContent=t(currentSource.kind==='photo'?'photoGuideReady':'momentGuideReady')
  momentGuide.classList.add('ready')
}

function showSource(kind,title=''){
  currentSource={kind,title:String(title||'').trim()}
  sourceToolbar.hidden=false
  sourceReady=true
  emptyState.hidden=true
  renderSourcePresentation()
  setControlsDisabled()
}

function formatInferenceTime(value){
  if(value===null||value===undefined||value==='')return '— ms'
  const milliseconds=Number(value)
  if(!Number.isFinite(milliseconds))return '— ms'
  return milliseconds<1000?`${Math.round(milliseconds)} ms`:`${(milliseconds/1000).toFixed(2)} s`
}

function outputTokenCount(result){
  const count=result?.output_tokens
  return typeof count==='number'&&Number.isSafeInteger(count)&&count>=0?count:null
}

function formatOutputTokens(result){
  const count=outputTokenCount(result)
  return count===null?`— ${t('outputTokens')}`:`${count} ${t('outputTokens')}`
}

function safeVisibleAnswer(result){
  if(result?.status!=='clear'||typeof result.answer!=='string')return null
  const value=result.answer.replace(/\r\n?/g,'\n').trim()
  if(!value)return null
  const compact=value.replace(/\s+/g,' ').trim()
  if(/^UNCLEAR[.!]?$/i.test(compact))return null
  if(/```|[{}\[\]]|"?(?:events?|actor_ref|target_ref|action|confidence|evidence|context|model_?output)"?\s*[:=]|^\s*(?:json|schema|template|output)\s*(?::|=|-|—)|\b(?:what is visible in this image|give a detailed natural-language description of the main subject|what objects are visible in this image|how are the visible people, animals, objects, furniture|including only details that can be seen directly|describe what is directly visible in this image|cover the main subject, setting, posture|use natural language and begin directly with the subject|use one short factual sentence|answer unclear|example json|schema|template)\b|\b[a-z_]{3,}\s*\|\s*[a-z_]{3,}\b/i.test(compact))return null
  return value
}

function renderModel(variant){
  const elements=modelElements[variant]
  const view=modelViews[variant]
  const safeAnswer=safeVisibleAnswer(view.result)
  let phase=view.phase
  if(phase==='result')phase=safeAnswer?(view.result?.finish_reason==='length'?'limited':'clear'):view.result?.status==='error'?'error':'unclear'
  elements.card.className=`model-result-card ${phase}`
  elements.card.dataset.state=phase
  elements.card.setAttribute('aria-busy',String(phase==='running'))
  const key={waiting:'modelWaiting',queued:'modelQueued',running:'modelRunning',clear:'modelReady',limited:'modelLimited',unclear:'modelUnclear',error:'modelError'}[phase]||'modelWaiting'
  const elapsed=phase==='running'&&Number.isFinite(view.startedAt)?Math.max(0,performance.now()-view.startedAt):null
  elements.state.textContent=elapsed===null?t(key):`${t(key)} · ${(elapsed/1000).toFixed(1)}s`
  elements.answer.textContent=phase==='clear'||phase==='limited'?safeAnswer:phase==='unclear'?t('momentUnclear'):phase==='error'?t('momentError'):''
  elements.inference.textContent=view.result?formatInferenceTime(view.result.inference_ms):'— ms'
  elements.outputTokens.textContent=formatOutputTokens(view.result)
}

function resetComparison({hideFreeze=true}={}){
  clearInterval(modelProgressTimer)
  modelProgressTimer=null
  analysing.hidden=true
  comparisonResults.hidden=true
  tryAgainButton.hidden=true
  analyseButton.hidden=false
  for(const variant of Object.keys(modelViews)){
    modelViews[variant].phase='waiting'
    modelViews[variant].result=null
    modelViews[variant].startedAt=null
    renderModel(variant)
  }
  if(hideFreeze)freezeCanvas.classList.remove('visible')
}

function clearPhotoSelection(){
  photoDecodeToken++
  photoObjectUrl.clear()
  clearThumbnailObjectUrls()
  photoSelection=createPhotoSelection([])
  photoPreview.removeAttribute('src')
  photoPreview.alt=''
  photoPreview.hidden=true
  photoQueue.hidden=true
  photoFilmstrip.replaceChildren()
  photoCounterOutput.textContent=''
}

function clearThumbnailObjectUrls(){
  for(const url of thumbnailObjectUrls)URL.revokeObjectURL(url)
  thumbnailObjectUrls.clear()
}

function clearVideoSource(){
  if(video.srcObject){video.srcObject.getTracks().forEach(track=>track.stop());video.srcObject=null}
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}
  video.pause()
  video.controls=false
  video.removeAttribute('src')
  video.load()
}

function prepareComparison(){
  modelViews.flash={phase:'queued',result:null,startedAt:null}
  modelViews.quality={phase:'queued',result:null,startedAt:null}
  renderModel('flash')
  renderModel('quality')
  comparisonResults.hidden=false
  tryAgainButton.hidden=true
  analysingTitle.textContent=t('momentLooking')
  analysing.hidden=false
  clearInterval(modelProgressTimer)
  modelProgressTimer=setInterval(()=>{
    for(const variant of Object.keys(modelViews))if(modelViews[variant].phase==='running')renderModel(variant)
  },100)
}

function stopCurrentSource(){
  requestToken++
  activeController?.abort()
  activeController=null
  busy=false
  sourceLoading=false
  resumeAfterTry=false
  clearVideoSource()
  clearPhotoSelection()
  currentSource=null
  sourceReady=false
  sourceBadge.hidden=true
  sourceToolbar.hidden=true
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
    video.hidden=false
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
    video.hidden=false
    objectUrl=URL.createObjectURL(file)
    video.src=objectUrl
    video.loop=false
    video.muted=true
    video.controls=true
    video.load()
    if(video.readyState<1)await waitForVideoEvent('loadedmetadata')
    if(video.readyState<2)await waitForVideoEvent('loadeddata')
    showSource('video',file.name)
    video.play().catch(()=>{})
  }catch{
    stopCurrentSource()
    momentGuide.textContent=t('videoError')
  }finally{
    sourceLoading=false
    setControlsDisabled()
  }
}

function renderPhotoFilmstrip(){
  const selected=photoSelection.index
  clearThumbnailObjectUrls()
  photoFilmstrip.replaceChildren(...photoSelection.items.map((item,index)=>{
    const button=document.createElement('button')
    button.type='button'
    button.className='photo-thumbnail'
    button.dataset.photoIndex=String(index)
    button.setAttribute('role','option')
    button.setAttribute('aria-selected',String(index===selected))
    button.setAttribute('aria-label',`${t('photoLabel')} ${index+1}: ${item.name}`)
    button.tabIndex=index===selected?0:-1
    const thumbnail=document.createElement('img')
    thumbnail.alt=''
    if(index===selected)thumbnail.src=photoPreview.currentSrc||photoPreview.src
    else{
      const thumbnailUrl=URL.createObjectURL(item.file)
      thumbnailObjectUrls.add(thumbnailUrl)
      let released=false
      const release=()=>{if(!released){released=true;thumbnailObjectUrls.delete(thumbnailUrl);URL.revokeObjectURL(thumbnailUrl)}}
      thumbnail.addEventListener('load',release,{once:true})
      thumbnail.addEventListener('error',release,{once:true})
      thumbnail.src=thumbnailUrl
    }
    button.append(thumbnail)
    return button
  }))
  photoCounterOutput.textContent=photoCounter(photoSelection)
  photoQueue.hidden=photoSelection.items.length<2
  setControlsDisabled()
}

async function showSelectedPhoto({focusThumbnail=false}={}){
  const item=photoSelection.items[photoSelection.index]
  if(!item)return false
  const token=++photoDecodeToken
  currentSource=null
  sourceReady=false
  sourceBadge.hidden=true
  momentGuide.textContent=t('momentGuide')
  momentGuide.classList.remove('ready')
  resetComparison()
  freezeCanvas.classList.remove('visible')
  const url=photoObjectUrl.replace(item.file)
  photoPreview.src=url
  photoPreview.alt=item.name
  photoPreview.hidden=false
  video.hidden=true
  try{
    if(typeof photoPreview.decode==='function')await photoPreview.decode()
    else if(!photoPreview.complete)await new Promise((resolve,reject)=>{photoPreview.addEventListener('load',resolve,{once:true});photoPreview.addEventListener('error',reject,{once:true})})
    if(token!==photoDecodeToken)return false
    if(!photoPreview.naturalWidth||!photoPreview.naturalHeight)throw new Error('invalid photo')
    showSource('photo',`${photoCounter(photoSelection)} · ${item.name}`)
    renderPhotoFilmstrip()
    if(focusThumbnail)photoFilmstrip.querySelector(`[data-photo-index="${photoSelection.index}"]`)?.focus()
    return true
  }catch{
    if(token===photoDecodeToken){
      const failedIndex=photoSelection.index
      photoSelection.items.splice(failedIndex,1)
      selectPhotoIndex(photoSelection,failedIndex)
      photoObjectUrl.clear()
      photoPreview.removeAttribute('src')
      photoPreview.alt=''
      photoPreview.hidden=true
      if(photoSelection.items.length)return showSelectedPhoto({focusThumbnail})
      currentSource=null
      sourceReady=false
      sourceBadge.hidden=true
      sourceToolbar.hidden=true
      emptyState.hidden=false
      photoQueue.hidden=true
      photoFilmstrip.replaceChildren()
      momentGuide.textContent=t('photoError')
      momentGuide.classList.remove('ready')
      setControlsDisabled()
    }
    return false
  }
}

async function openPhotos(files){
  const selection=createPhotoSelection(files)
  stopCurrentSource()
  if(!selection.items.length){momentGuide.textContent=t('photoError');return}
  photoSelection=selection
  sourceLoading=true
  setControlsDisabled()
  await showSelectedPhoto()
  sourceLoading=false
  setControlsDisabled()
}

async function choosePhoto(index,{focusThumbnail=false}={}){
  if(busy||sourceLoading||!photoSelection.items.length)return
  selectPhotoIndex(photoSelection,index)
  sourceLoading=true
  setControlsDisabled()
  await showSelectedPhoto({focusThumbnail})
  sourceLoading=false
  setControlsDisabled()
}

function frozenJpeg(){
  const source=currentSource?.kind==='photo'?photoPreview:video
  const width=currentSource?.kind==='photo'?photoPreview.naturalWidth:video.videoWidth
  const height=currentSource?.kind==='photo'?photoPreview.naturalHeight:video.videoHeight
  const dimensions=fitDimensions(width,height)
  freezeCanvas.width=dimensions.width
  freezeCanvas.height=dimensions.height
  freezeContext.drawImage(source,0,0,dimensions.width,dimensions.height)
  return new Promise(resolve=>freezeCanvas.toBlob(resolve,'image/jpeg',.9))
}

function handleComparisonEvent(event){
  if(!event||typeof event!=='object')return false
  if(event.type==='model-start'&&Object.hasOwn(modelViews,event.variant)){
    modelViews[event.variant].phase='running'
    modelViews[event.variant].startedAt=performance.now()
    renderModel(event.variant)
  }
  if(event.type==='model-result'&&Object.hasOwn(modelViews,event.result?.variant)){
    const variant=event.result.variant
    modelViews[variant].phase='result'
    modelViews[variant].result=event.result
    modelViews[variant].startedAt=null
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
  const photoReady=currentSource?.kind==='photo'&&photoPreview.complete&&photoPreview.naturalWidth>0
  const videoReady=currentSource?.kind!=='photo'&&video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0
  if(busy||sourceLoading||!modelsReady||!sourceReady||(!photoReady&&!videoReady))return
  const token=++requestToken
  busy=true
  activeController=new AbortController()
  resumeAfterTry=currentSource?.kind==='video'&&!video.paused
  if(currentSource?.kind==='video')video.pause()
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
      clearInterval(modelProgressTimer)
      modelProgressTimer=null
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
  if(shouldResume&&currentSource?.kind==='video')video.play().catch(()=>{})
}

function applyLanguage(){
  language=languageSelect.value==='it'?'it':'en'
  document.documentElement.lang=language
  document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)})
  document.querySelectorAll('[data-i18n-aria]').forEach(element=>{element.setAttribute('aria-label',t(element.dataset.i18nAria))})
  if(currentSource&&sourceReady&&!sourceLoading)renderSourcePresentation()
  else if(!sourceLoading){momentGuide.textContent=t('momentGuide');momentGuide.classList.remove('ready')}
  if(busy)analysingTitle.textContent=t('momentLooking')
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
photoButton.addEventListener('click',()=>{photoFiles.value='';photoFiles.click()})
photoFiles.addEventListener('change',()=>openPhotos(photoFiles.files))
switchCameraButton.addEventListener('click',startCamera)
switchVideoButton.addEventListener('click',()=>{videoFile.value='';videoFile.click()})
switchPhotoButton.addEventListener('click',()=>{photoFiles.value='';photoFiles.click()})
previousPhoto.addEventListener('click',()=>{movePhotoIndex(photoSelection,-1);choosePhoto(photoSelection.index,{focusThumbnail:true})})
nextPhoto.addEventListener('click',()=>{movePhotoIndex(photoSelection,1);choosePhoto(photoSelection.index,{focusThumbnail:true})})
photoFilmstrip.addEventListener('click',event=>{
  const button=event.target.closest('[data-photo-index]')
  if(button)choosePhoto(Number(button.dataset.photoIndex),{focusThumbnail:true})
})
photoFilmstrip.addEventListener('keydown',event=>{
  const index=event.key==='Home'?0:event.key==='End'?photoSelection.items.length-1:event.key==='ArrowLeft'?photoSelection.index-1:event.key==='ArrowRight'?photoSelection.index+1:null
  if(index!==null){event.preventDefault();choosePhoto(index,{focusThumbnail:true})}
})
analyseButton.addEventListener('click',analyseCurrentMoment)
tryAgainButton.addEventListener('click',tryAnotherMoment)
languageSelect.addEventListener('change',applyLanguage)
video.addEventListener('play',()=>{if(!busy&&freezeCanvas.classList.contains('visible'))tryAnotherMoment()})
window.addEventListener('pagehide',()=>{clearInterval(statusTimer);clearInterval(modelProgressTimer);stopCurrentSource()})

applyLanguage()
refreshStatus()
statusTimer=setInterval(refreshStatus,5_000)
