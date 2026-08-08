const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0))
const median=values=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2}
const clean=value=>String(value??'').trim()

export const NARRATIVE_V2_VERSION='2.0.0'

export const NOISE_ACTIONS=new Set([
  'movement','moved_left','moved_right','moved_up','moved_down','closer_to_camera','farther_from_camera','shifted',
  'detected','detection','bounding_box_change','camera_relative_motion'
])

export const ACTION_PRIORITY={
  urinating:5.0,defecating:5.0,eating:4.9,drinking:4.9,
  petting:4.9,feeding:4.9,playing:4.8,chasing:4.8,fetching:4.8,tugging:4.8,
  picking_up:4.8,dropping:4.6,carrying:4.5,holding:4.1,chewing:4.2,biting:4.1,
  offering:4.7,throwing:4.7,using_object:4.4,mouth_contact:4.1,
  entering:4.8,leaving:4.8,crossing:4.7,jumping_on:4.7,jumping_off:4.7,climbing:4.5,descending:4.5,
  dog_dog_interaction:4.6,person_dog_interaction:4.7,following:4.2,approaching:3.8,
  tail_wagging:3.8,rolling:4.0,rubbing:3.7,shaking:3.8,stretching:3.4,scratching:3.3,licking:3.5,sniffing:3.3,
  sitting_down:3.7,standing_up:3.7,lying_down:3.8,posture_change:3.5,
  sitting:2.8,standing:2.6,lying:2.8,sleeping:3.5,resting:2.4,
  running:3.5,walking:2.4,jumping:4.0,
  mouth_open:2.2,tongue_visible:2.0,head_tilt:2.4,head_lowered:2.1,
  scene_change:3.2,other:2.0
}

export function actionPriority(action){return ACTION_PRIORITY[action]??(NOISE_ACTIONS.has(action)?0:2)}

export function canonicalAction(action='other'){
  const value=clean(action).toLowerCase().replace(/[\s-]+/g,'_')
  const aliases={
    lie:'lying',lies:'lying',liedown:'lying_down',lie_down:'lying_down',
    sit:'sitting',sits:'sitting',sit_down:'sitting_down',
    stand:'standing',stands:'standing',stand_up:'standing_up',
    wag:'tail_wagging',wags:'tail_wagging',tail_movement:'tail_wagging',
    pets:'petting',pet:'petting',plays:'playing',play:'playing',
    sniff:'sniffing',sniffs:'sniffing',chew:'chewing',chews:'chewing',
    pick_up:'picking_up',pickup:'picking_up',putting_down:'dropping',drop:'dropping',
    jump_on:'jumping_on',jump_off:'jumping_off'
  }
  return aliases[value]||value||'other'
}

export function eventKey(event){
  const object=(event.objects||[]).map(item=>typeof item==='string'?item:item?.id||item?.label).filter(Boolean).sort().join(',')
  return [event.actor||'unknown',canonicalAction(event.action),event.target||'',event.from?.surface||'',event.to?.surface||'',object].join('|')
}

export function makeEvent(input={}){
  const start=Number(input.start??input.at??input.videoSeconds??0)
  const end=Math.max(start,Number(input.end??start))
  const confidence=clamp(input.confidence??0.5)
  const action=canonicalAction(input.action)
  const importance=clamp(input.importance??Math.min(1,actionPriority(action)/5),0,1)
  return {
    id:clean(input.id)||`evt_${Math.random().toString(36).slice(2,10)}`,
    start,end,actor:clean(input.actor)||null,action,target:clean(input.target)||null,
    from:input.from||null,to:input.to||null,objects:Array.isArray(input.objects)?input.objects:[],
    modifiers:input.modifiers||{},evidence:input.evidence||{},confidence,importance,
    description:clean(input.description||input.detail),source:clean(input.source)||'unknown',
    rawIds:Array.isArray(input.rawIds)?input.rawIds:[],meta:input.meta||{}
  }
}

export function eventSalience(event,{sessionDuration=0,novelty=1,coverageBonus=0}={}){
  const action=canonicalAction(event.action)
  if(NOISE_ACTIONS.has(action))return 0
  const priority=actionPriority(action)/5
  const confidence=clamp(event.confidence)
  const duration=Math.max(0,(event.end||0)-(event.start||0))
  const durationScore=Math.min(1,duration/6)
  const importance=clamp(event.importance??priority)
  const durationBonus=['petting','playing','chasing','sniffing','walking','running','chewing','tail_wagging','resting','sleeping'].includes(action)?durationScore*.08:0
  const temporalEdge=sessionDuration>0&&((event.start/sessionDuration)<.12||(event.end/sessionDuration)>.88) ? .04 : 0
  return clamp(priority*.46+confidence*.28+importance*.16+durationBonus+clamp(novelty)*.06+coverageBonus+temporalEdge)
}

export class StateStabilizer{
  constructor({confirmMs=650,unknownGraceMs=900}={}){this.confirmMs=confirmMs;this.unknownGraceMs=unknownGraceMs;this.byActor=new Map()}
  update(actor,candidate,timeMs,confidence=.5){
    if(!actor||!Number.isFinite(timeMs))return null
    const state=this.byActor.get(actor)||{current:null,currentSince:timeMs,pending:null,pendingSince:0,lastSeen:timeMs}
    state.lastSeen=timeMs
    if(!candidate||candidate==='unknown'){
      if(state.current&&timeMs-state.lastSeen<=this.unknownGraceMs){this.byActor.set(actor,state);return null}
      return null
    }
    if(candidate===state.current){state.pending=null;state.pendingSince=0;this.byActor.set(actor,state);return null}
    if(state.pending!==candidate){state.pending=candidate;state.pendingSince=timeMs;state.pendingConfidence=confidence;this.byActor.set(actor,state);return null}
    if(timeMs-state.pendingSince<this.confirmMs){state.pendingConfidence=Math.max(state.pendingConfidence||0,confidence);this.byActor.set(actor,state);return null}
    const previous=state.current,previousSince=state.currentSince
    state.current=candidate;state.currentSince=state.pendingSince;state.pending=null;state.pendingSince=0
    this.byActor.set(actor,state)
    return {actor,previous,current:candidate,previousSince,currentSince:state.currentSince,at:timeMs,confidence:clamp(state.pendingConfidence||confidence)}
  }
  get(actor){return this.byActor.get(actor)?.current||null}
  reset(){this.byActor.clear()}
}

export class TailWagDetector{
  constructor({windowMs=1800,minSamples=5,minAmplitude=.024,minReversals=2,endHoldMs=900}={}){
    Object.assign(this,{windowMs,minSamples,minAmplitude,minReversals,endHoldMs});this.byActor=new Map()
  }
  update(actor,timeMs,x,confidence=.5){
    if(!actor||!Number.isFinite(x))return null
    const state=this.byActor.get(actor)||{samples:[],active:false,startedAt:null,lastPositiveAt:null,confidence:0}
    state.samples.push({t:timeMs,x:Number(x),c:clamp(confidence)});state.samples=state.samples.filter(sample=>timeMs-sample.t<=this.windowMs)
    const xs=state.samples.map(sample=>sample.x),center=median(xs),deviations=state.samples.map(sample=>sample.x-center)
    const amplitude=xs.length?Math.max(...xs)-Math.min(...xs):0
    let reversals=0,lastSign=0
    for(const value of deviations){const sign=Math.abs(value)<this.minAmplitude*.18?0:(value>0?1:-1);if(sign&&lastSign&&sign!==lastSign)reversals++;if(sign)lastSign=sign}
    const enough=state.samples.length>=this.minSamples&&amplitude>=this.minAmplitude&&reversals>=this.minReversals
    const score=clamp(.45+Math.min(.25,reversals*.06)+Math.min(.2,(amplitude/this.minAmplitude-1)*.12)+median(state.samples.map(s=>s.c))*.12)
    let transition=null
    if(enough){state.lastPositiveAt=timeMs;state.confidence=Math.max(state.confidence,score);if(!state.active){state.active=true;state.startedAt=state.samples[0].t;transition={type:'start',actor,start:state.startedAt,at:timeMs,confidence:score}}}
    else if(state.active&&state.lastPositiveAt!=null&&timeMs-state.lastPositiveAt>=this.endHoldMs){transition={type:'end',actor,start:state.startedAt,end:state.lastPositiveAt,at:timeMs,confidence:state.confidence};state.active=false;state.startedAt=null;state.confidence=0}
    this.byActor.set(actor,state);return transition
  }
  flush(actor,timeMs){const state=this.byActor.get(actor);if(!state?.active)return null;state.active=false;return {type:'end',actor,start:state.startedAt,end:state.lastPositiveAt??timeMs,at:timeMs,confidence:state.confidence}}
  reset(){this.byActor.clear()}
}

export class BooleanIntervalDetector{
  constructor({startHoldMs=350,endHoldMs=550}={}){this.startHoldMs=startHoldMs;this.endHoldMs=endHoldMs;this.byKey=new Map()}
  update(key,timeMs,active,confidence=.5,meta={}){
    const state=this.byKey.get(key)||{active:false,pendingStart:null,pendingEnd:null,startedAt:null,confidence:0,meta:{}}
    let transition=null
    if(active){state.pendingEnd=null;state.confidence=Math.max(state.confidence,confidence);state.meta={...state.meta,...meta};if(!state.active){state.pendingStart??=timeMs;if(timeMs-state.pendingStart>=this.startHoldMs){state.active=true;state.startedAt=state.pendingStart;state.pendingStart=null;transition={type:'start',key,start:state.startedAt,at:timeMs,confidence:clamp(state.confidence),meta:state.meta}}}}
    else{state.pendingStart=null;if(state.active){state.pendingEnd??=timeMs;if(timeMs-state.pendingEnd>=this.endHoldMs){transition={type:'end',key,start:state.startedAt,end:state.pendingEnd,at:timeMs,confidence:clamp(state.confidence),meta:state.meta};state.active=false;state.startedAt=null;state.pendingEnd=null;state.confidence=0;state.meta={}}}}
    this.byKey.set(key,state);return transition
  }
  flush(timeMs){
    const transitions=[]
    for(const [key,state] of this.byKey)if(state.active){transitions.push({type:'end',key,start:state.startedAt,end:state.pendingEnd??timeMs,at:timeMs,confidence:clamp(state.confidence),meta:state.meta});state.active=false;state.startedAt=null;state.pendingEnd=null;state.confidence=0;state.meta={}}
    return transitions
  }
  reset(){this.byKey.clear()}
}

export function estimateCameraMotion(referenceMotions=[]){
  const usable=referenceMotions.filter(item=>item&&Number.isFinite(item.dx)&&Number.isFinite(item.dy))
  if(!usable.length)return {dx:0,dy:0,scale:0,confidence:0}
  const weights=usable.map(item=>clamp(item.confidence??.5,.05,1))
  const weightedMedian=key=>{const expanded=[];usable.forEach((item,index)=>expanded.push({value:Number(item[key]||0),weight:weights[index]}));expanded.sort((a,b)=>a.value-b.value);const total=expanded.reduce((sum,item)=>sum+item.weight,0);let running=0;for(const item of expanded){running+=item.weight;if(running>=total/2)return item.value}return 0}
  return {dx:weightedMedian('dx'),dy:weightedMedian('dy'),scale:weightedMedian('scale'),confidence:clamp(usable.length/4)}
}

export function compensateMotion(subjectMotion={},cameraMotion={}){
  return {dx:Number(subjectMotion.dx||0)-Number(cameraMotion.dx||0),dy:Number(subjectMotion.dy||0)-Number(cameraMotion.dy||0),scale:Number(subjectMotion.scale||0)-Number(cameraMotion.scale||0)}
}

export function mergeEvents(inputEvents=[],{gapSeconds=1.6,maxContinuousGapSeconds=2.8}={}){
  const sorted=inputEvents.map(makeEvent).filter(event=>event.description||event.action).sort((a,b)=>a.start-b.start||a.end-b.end)
  const merged=[]
  const continuous=new Set(['petting','playing','chasing','sniffing','walking','running','chewing','tail_wagging','resting','sleeping','holding','carrying','following'])
  for(const event of sorted){
    if(NOISE_ACTIONS.has(event.action))continue
    const previous=merged.at(-1),same=previous&&eventKey(previous)===eventKey(event)
    const allowedGap=continuous.has(event.action)?maxContinuousGapSeconds:gapSeconds
    if(same&&event.start-previous.end<=allowedGap){
      previous.end=Math.max(previous.end,event.end);previous.confidence=Math.max(previous.confidence,event.confidence);previous.importance=Math.max(previous.importance,event.importance)
      previous.rawIds=[...new Set([...(previous.rawIds||[]),...(event.rawIds||[])])]
      previous.evidence={...previous.evidence,...event.evidence}
      if(event.description&&event.description.length>previous.description.length)previous.description=event.description
      continue
    }
    merged.push({...event})
  }
  return merged
}

export function selectNarrativeEvents(inputEvents=[],{sessionDuration=0,maxEvents=8,minConfidence=.48}={}){
  const events=mergeEvents(inputEvents).filter(event=>event.confidence>=minConfidence&&!NOISE_ACTIONS.has(event.action))
  if(!events.length)return []
  const duration=sessionDuration||Math.max(...events.map(event=>event.end||event.start||0),1)
  const groups=new Map()
  for(const event of events){const group=[event.actor||'scene',event.action,event.target||'',event.objects?.[0]?.id||event.objects?.[0]||''].join('|');groups.set(group,(groups.get(group)||0)+1)}
  const scored=events.map(event=>{const group=[event.actor||'scene',event.action,event.target||'',event.objects?.[0]?.id||event.objects?.[0]||''].join('|');const novelty=1/Math.sqrt(groups.get(group)||1);return {...event,_score:eventSalience(event,{sessionDuration:duration,novelty})}})
  const bins=[[],[],[],[]]
  for(const event of scored){const midpoint=(event.start+event.end)/2,b=Math.min(3,Math.floor((midpoint/duration)*4));bins[b].push(event)}
  const chosen=[];const ids=new Set()
  for(const bin of bins){const best=bin.sort((a,b)=>b._score-a._score)[0];if(best&&!ids.has(best.id)){chosen.push(best);ids.add(best.id)}}
  for(const event of [...scored].sort((a,b)=>b._score-a._score)){if(chosen.length>=maxEvents)break;if(!ids.has(event.id)){chosen.push(event);ids.add(event.id)}}
  return chosen.sort((a,b)=>a.start-b.start).map(({_score,...event})=>event)
}

export function summaryPayload(events,{sessionDuration=0,maxEvents=8,context={}}={}){
  const selected=selectNarrativeEvents(events,{sessionDuration,maxEvents})
  return {version:NARRATIVE_V2_VERSION,sessionDuration,context,events:selected.map(event=>({start:event.start,end:event.end,actor:event.actor,action:event.action,target:event.target,from:event.from,to:event.to,objects:event.objects,confidence:event.confidence,importance:event.importance,description:event.description}))}
}

export class SessionDebugRecorder{
  constructor({sessionId=`session_${Date.now()}`,source=null}={}){this.reset({sessionId,source})}
  reset({sessionId=`session_${Date.now()}`,source=null}={}){this.sessionId=sessionId;this.source=source;this.startedAt=new Date().toISOString();this.raw=[];this.semantic=[];this.merged=[];this.context=[];this.finalSummary=null;this.meta={version:NARRATIVE_V2_VERSION}}
  addRaw(value){this.raw.push({...value,recordedAt:new Date().toISOString()})}
  addSemantic(value){this.semantic.push({...makeEvent(value),recordedAt:new Date().toISOString()})}
  addContext(value){this.context.push({...value,recordedAt:new Date().toISOString()})}
  setMerged(events){this.merged=mergeEvents(events)}
  setSummary(summary){this.finalSummary=summary}
  toJSON(){return {sessionId:this.sessionId,source:this.source,startedAt:this.startedAt,exportedAt:new Date().toISOString(),meta:this.meta,raw:this.raw,semantic:this.semantic,merged:this.merged,context:this.context,finalSummary:this.finalSummary}}
  download(filename=`ai-pet-detective-${this.sessionId}.json`){
    if(typeof document==='undefined'||typeof URL==='undefined')return this.toJSON()
    const blob=new Blob([JSON.stringify(this.toJSON(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),500);return this.toJSON()
  }
}

export class NarrativeEngineV2{
  constructor(options={}){this.options=options;this.semantic=[];this.debug=options.debugRecorder||new SessionDebugRecorder({sessionId:options.sessionId,source:options.source});this.posture=new StateStabilizer({confirmMs:options.postureConfirmMs??650});this.surface=new StateStabilizer({confirmMs:options.surfaceConfirmMs??700});this.tail=new TailWagDetector(options.tail);this.intervals=new BooleanIntervalDetector()}
  addEvent(event){const normalized=makeEvent(event);this.semantic.push(normalized);this.debug.addSemantic(normalized);return normalized}
  updatePosture(actor,candidate,timeMs,confidence=.6,description=null){const transition=this.posture.update(actor,candidate,timeMs,confidence);if(!transition||!transition.previous)return null;const map={sitting:'sitting_down',standing:'standing_up',lying:'lying_down'};return this.addEvent({start:transition.currentSince/1000,end:timeMs/1000,actor,action:map[transition.current]||'posture_change',confidence:transition.confidence,description:description||`${actor} changes posture from ${transition.previous} to ${transition.current}.`,source:'pose'})}
  updateSurface(actor,candidate,timeMs,confidence=.6,description=null){const transition=this.surface.update(actor,candidate,timeMs,confidence);if(!transition||!transition.previous)return null;const action=transition.current==='floor'&&transition.previous!=='floor'?'jumping_off':transition.previous==='floor'&&transition.current!=='floor'?'jumping_on':'scene_change';return this.addEvent({start:transition.currentSince/1000,end:timeMs/1000,actor,action,from:{surface:transition.previous},to:{surface:transition.current},confidence:transition.confidence,description:description||`${actor} moves from ${transition.previous} to ${transition.current}.`,source:'surface'})}
  updateTail(actor,timeMs,tailX,confidence=.6){const transition=this.tail.update(actor,timeMs,tailX,confidence);if(transition?.type==='end')return this.addEvent({start:transition.start/1000,end:transition.end/1000,actor,action:'tail_wagging',confidence:transition.confidence,description:`${actor} repeatedly wags its tail.`,source:'pose'});return null}
  merge(){const result=mergeEvents(this.semantic,this.options.merge);this.debug.setMerged(result);return result}
  storyEvents(sessionDuration=0){return selectNarrativeEvents(this.merge(),{sessionDuration,maxEvents:this.options.maxStoryEvents??8})}
  summaryPayload(sessionDuration=0,context={}){return summaryPayload(this.merge(),{sessionDuration,maxEvents:this.options.maxStoryEvents??8,context})}
}
