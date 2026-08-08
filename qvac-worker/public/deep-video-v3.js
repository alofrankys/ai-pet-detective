import { NOISE_ACTIONS, canonicalAction, makeEvent, mergeEvents, selectNarrativeEvents } from './narrative-engine-v2.js'

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0))
const median=values=>{if(!values.length)return 0;const ordered=[...values].sort((a,b)=>a-b),middle=Math.floor(ordered.length/2);return ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2}
const distance=(a,b)=>Math.hypot(Number(a?.x||0)-Number(b?.x||0),Number(a?.y||0)-Number(b?.y||0))
const boxCenter=box=>({x:(box[0]+box[2])/2,y:(box[1]+box[3])/2})
const boxArea=box=>Math.max(0,box[2]-box[0])*Math.max(0,box[3]-box[1])
const iou=(a,b)=>{const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]),intersection=Math.max(0,x2-x1)*Math.max(0,y2-y1);return intersection/Math.max(1e-6,boxArea(a)+boxArea(b)-intersection)}

export const DEEP_VIDEO_V3_VERSION='3.0.0'
export const V3_ACTIONS=new Set(['petting','lying_down','standing_up','sitting_down','jumping_off','jumping_on','approaching_person','rear_up','tail_wagging','sniffing','object_presented','mouth_contact','picking_up','holding','carrying','playing','tugging','dropping','dog_dog_interaction','person_dog_interaction','resting','walking','running','rolling','other'])
export const V3_HIGH_SPECIFICITY=new Set(['biting','eating','drinking','urinating','defecating'])
const ALL_V3_ACTIONS=new Set([...V3_ACTIONS,...V3_HIGH_SPECIFICITY])
const ACTION_TOKEN='(?:petting|lying_down|standing_up|sitting_down|jumping_off|jumping_on|approaching_person|rear_up|tail_wagging|sniffing|object_presented|mouth_contact|picking_up|holding|carrying|playing|tugging|dropping|dog_dog_interaction|person_dog_interaction|resting|walking|running|rolling|biting|eating|drinking|urinating|defecating|other)'
const PIPE_ACTION_LIST=new RegExp(`${ACTION_TOKEN}\\s*\\|\\s*${ACTION_TOKEN}`,'i')

export function isVisionSchemaEcho(value){
  const text=String(value||'').trim()
  if(!text)return false
  return PIPE_ACTION_LIST.test(text)||/<\/?(?:action|actor|placeholder)>|\b(?:schema|template|placeholder|example json)\b/i.test(text)||/"action"\s*:\s*"(?:observed_action|allowed action|action_name|\.\.\.)"/i.test(text)||/"evidence"\s*:\s*\[\s*"(?:short observable reason|observable evidence|\.\.\.)"\s*\]/i.test(text)||/"confidence"\s*:\s*0\.82[\s\S]*"description"\s*:\s*"A person repeatedly strokes subject_1\."/i.test(text)
}

export function cleanNaturalLanguageObservation(value){
  const text=String(value||'').replace(/\s+/g,' ').trim()
  if(text.length<12||text.length>500||isVisionSchemaEcho(text)||/```|[{}\[\]]/.test(text)||/"(?:events?|actor_ref|target_ref|action|confidence|evidence|context)"\s*:/i.test(text)||/^\s*(?:json|output|response)\s*:/i.test(text))return null
  const sentence=(text.match(/^.{1,260}?(?:[.!?](?=\s|$)|$)/)?.[0]||'').trim()
  if(sentence.length<12||PIPE_ACTION_LIST.test(sentence))return null
  return sentence
}

function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;let h=0
  if(delta){if(max===r)h=((g-b)/delta)%6;else if(max===g)h=(b-r)/delta+2;else h=(r-g)/delta+4;h=(h*60+360)%360}
  return [h/360,max?delta/max:0,max]
}

export function appearanceDescriptor(rgba,width,height,box){
  const hue=new Array(12).fill(0),sat=new Array(4).fill(0),val=new Array(4).fill(0)
  const x1=Math.max(0,Math.floor(box[0]*width)),x2=Math.min(width-1,Math.ceil(box[2]*width)),y1=Math.max(0,Math.floor(box[1]*height)),y2=Math.min(height-1,Math.ceil(box[3]*height));let samples=0
  const step=Math.max(2,Math.floor(Math.max(x2-x1,y2-y1)/24))
  for(let y=y1;y<=y2;y+=step)for(let x=x1;x<=x2;x+=step){const offset=(y*width+x)*4;if((rgba[offset+3]??255)<128)continue;const [h,s,v]=rgbToHsv(rgba[offset],rgba[offset+1],rgba[offset+2]);hue[Math.min(11,Math.floor(h*12))]++;sat[Math.min(3,Math.floor(s*4))]++;val[Math.min(3,Math.floor(v*4))]++;samples++}
  const normalize=values=>values.map(value=>samples?value/samples:0),w=Math.max(.001,box[2]-box[0]),h=Math.max(.001,box[3]-box[1])
  return {histogram:[...normalize(hue),...normalize(sat),...normalize(val)],shape:[clamp(w/h/3),clamp(boxArea(box)*4),clamp(w),clamp(h)]}
}

export function descriptorSimilarity(first,second){
  if(!first?.histogram?.length||first.histogram.length!==second?.histogram?.length)return 0
  const intersection=first.histogram.reduce((sum,value,index)=>sum+Math.min(value,second.histogram[index]),0)/3
  const shapeDistance=Math.sqrt(first.shape.reduce((sum,value,index)=>sum+(value-(second.shape[index]||0))**2,0)/first.shape.length)
  return clamp(intersection*.8+(1-clamp(shapeDistance*2))*.2)
}

export class PersistentIdentityManager{
  constructor({newSubjectFrames=10,newSubjectSeconds=1.8,retireSeconds=18,matchThreshold=.48}={}){Object.assign(this,{newSubjectFrames,newSubjectSeconds,retireSeconds,matchThreshold});this.subjects=new Map();this.pending=new Map();this.nextId=1}
  _components(detection,subject,cameraMotion={}){
    const appearance=descriptorSimilarity(detection.descriptor,subject.descriptor),nowCenter=boxCenter(detection.box),previousCenter=boxCenter(subject.box),predicted={x:previousCenter.x+Number(cameraMotion.dx||0),y:previousCenter.y+Number(cameraMotion.dy||0)},spatial=1-clamp(distance(nowCenter,predicted)/.55),shape=1-clamp(Math.abs(Math.log(Math.max(.001,boxArea(detection.box))/Math.max(.001,boxArea(subject.box))))/2),recency=1-clamp((detection.time-subject.lastSeen)/this.retireSeconds)
    return {appearance,spatial,shape,recency,total:appearance*.46+spatial*.28+shape*.14+recency*.12}
  }
  update(detections,time,cameraMotion={}){
    const output=[],claimed=new Set(),dogs=detections.filter(item=>item.label==='dog')
    for(const detection of dogs){
      let best=null
      for(const subject of this.subjects.values()){if(claimed.has(subject.subject_id)||time-subject.lastSeen>this.retireSeconds)continue;const components=this._components({...detection,time},subject,cameraMotion);if(!best||components.total>best.components.total)best={subject,components}}
      if(best&&best.components.total>=this.matchThreshold){
        const revived=time-best.subject.lastSeen>.9;best.subject.box=[...detection.box];best.subject.lastSeen=time;best.subject.frames++;best.subject.descriptor=detection.descriptor||best.subject.descriptor;claimed.add(best.subject.subject_id)
        output.push({...detection,subject_id:best.subject.subject_id,reid_score:best.components.total,reid_components:best.components,identity_decision:revived?'revived':'matched'})
        continue
      }
      const key=detection.track_id||`pending:${Math.round(boxCenter(detection.box).x*8)}:${Math.round(boxCenter(detection.box).y*8)}`,pending=this.pending.get(key)||{firstSeen:time,frames:0,lastSeen:time,descriptor:detection.descriptor,box:detection.box};pending.frames++;pending.lastSeen=time;pending.box=detection.box;pending.descriptor=detection.descriptor||pending.descriptor;this.pending.set(key,pending)
      const stable=pending.frames>=this.newSubjectFrames||time-pending.firstSeen>=this.newSubjectSeconds
      if(stable){const subject_id=`subject_${this.nextId++}`,subject={subject_id,box:[...detection.box],descriptor:pending.descriptor,firstSeen:pending.firstSeen,lastSeen:time,frames:pending.frames};this.subjects.set(subject_id,subject);this.pending.delete(key);claimed.add(subject_id);output.push({...detection,subject_id,reid_score:best?.components.total||0,reid_components:best?.components||{},identity_decision:'new'})}
      else output.push({...detection,subject_id:null,reid_score:best?.components.total||0,reid_components:best?.components||{},identity_decision:'uncertain'})
    }
    for(const [key,item] of this.pending)if(time-item.lastSeen>2.5)this.pending.delete(key)
    return output
  }
  snapshot(){return [...this.subjects.values()].map(subject=>({...subject,descriptor:undefined}))}
  reset(){this.subjects.clear();this.pending.clear();this.nextId=1}
}

export function rgbaToGray(rgba,width,height,targetWidth=80,targetHeight=80){
  const gray=new Uint8Array(targetWidth*targetHeight)
  for(let y=0;y<targetHeight;y++)for(let x=0;x<targetWidth;x++){const sx=Math.min(width-1,Math.floor((x+.5)*width/targetWidth)),sy=Math.min(height-1,Math.floor((y+.5)*height/targetHeight)),offset=(sy*width+sx)*4;gray[y*targetWidth+x]=Math.round(rgba[offset]*.299+rgba[offset+1]*.587+rgba[offset+2]*.114)}
  return {gray,width:targetWidth,height:targetHeight}
}

function motionMask(width,height,boxes=[],margin=.06){
  const mask=new Uint8Array(width*height)
  for(const box of boxes){const x1=Math.max(0,Math.floor((box[0]-margin)*width)),y1=Math.max(0,Math.floor((box[1]-margin)*height)),x2=Math.min(width-1,Math.ceil((box[2]+margin)*width)),y2=Math.min(height-1,Math.ceil((box[3]+margin)*height));for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++)mask[y*width+x]=1}
  return mask
}

export function estimateGlobalTranslation(previous,current,{width=80,height=80,previousBoxes=[],currentBoxes=[],maxShift=8}={}){
  if(!previous?.length||previous.length!==current?.length)return {dx:0,dy:0,scale:0,rotation:0,confidence:0,inliers:0,residual:255}
  const previousMask=motionMask(width,height,previousBoxes),currentMask=motionMask(width,height,currentBoxes),scores=[]
  for(let dy=-maxShift;dy<=maxShift;dy++)for(let dx=-maxShift;dx<=maxShift;dx++){
    let residual=0,count=0,inliers=0
    for(let y=6;y<height-6;y+=2)for(let x=6;x<width-6;x+=2){const px=x-dx,py=y-dy;if(px<0||px>=width||py<0||py>=height||currentMask[y*width+x]||previousMask[py*width+px])continue;const difference=Math.abs(current[y*width+x]-previous[py*width+px]);residual+=difference;count++;if(difference<18)inliers++}
    if(count>80)scores.push({dx,dy,residual:residual/count,inliers,count})
  }
  scores.sort((a,b)=>a.residual-b.residual);const best=scores[0]
  if(!best)return {dx:0,dy:0,scale:0,rotation:0,confidence:0,inliers:0,residual:255}
  const runner=scores.find(item=>Math.abs(item.dx-best.dx)+Math.abs(item.dy-best.dy)>1)||scores[1]||best,margin=clamp((runner.residual-best.residual)/Math.max(4,runner.residual)),inlierRatio=best.inliers/best.count,coverage=clamp(best.count/800),confidence=clamp(inlierRatio*.55+margin*.25+coverage*.2)
  return {dx:best.dx/width,dy:best.dy/height,scale:0,rotation:0,confidence,inliers:best.inliers,residual:Number(best.residual.toFixed(3))}
}

export class BackgroundMotionEstimator{
  constructor({width=80,height=80,maxShift=8}={}){Object.assign(this,{width,height,maxShift});this.previous=null;this.previousBoxes=[]}
  update(rgba,sourceWidth,sourceHeight,dynamicBoxes=[]){const current=rgbaToGray(rgba,sourceWidth,sourceHeight,this.width,this.height).gray,result=this.previous?estimateGlobalTranslation(this.previous,current,{width:this.width,height:this.height,previousBoxes:this.previousBoxes,currentBoxes:dynamicBoxes,maxShift:this.maxShift}):{dx:0,dy:0,scale:0,rotation:0,confidence:0,inliers:0,residual:0};this.previous=current;this.previousBoxes=dynamicBoxes.map(box=>[...box]);return result}
  reset(){this.previous=null;this.previousBoxes=[]}
}

export function compensateSubjectMotionV3(observed={},camera={}){const valid=Number(camera.confidence)>=.25,dx=valid?Number(observed.dx||0)-Number(camera.dx||0):0,dy=valid?Number(observed.dy||0)-Number(camera.dy||0):0;return {dx,dy,magnitude:Math.hypot(dx,dy),valid}}

const SURFACE_LABELS=new Set(['couch','bed','chair','bench','dining table'])
export class PersistentSurfaceMap{
  constructor({confirmFrames=4,switchMargin=.22,relationFrames=3,relationSeconds=.35,cooldownSeconds=1.25}={}){Object.assign(this,{confirmFrames,switchMargin,relationFrames,relationSeconds,cooldownSeconds});this.entities=new Map();this.relations=new Map();this.nextId=1}
  updateDetections(detections,time){
    for(const detection of detections.filter(item=>SURFACE_LABELS.has(item.label))){let entity=[...this.entities.values()].filter(item=>time-item.lastSeen<8).sort((a,b)=>iou(b.box,detection.box)-iou(a.box,detection.box))[0];if(!entity||iou(entity.box,detection.box)<.28){entity={surface_id:`surface_${this.nextId++}`,box:[...detection.box],type_probs:{},stable_type:'furniture_surface',pending_type:null,stableFrames:0,geometry_history:[],lastSeen:time};this.entities.set(entity.surface_id,entity)}
      for(const label of Object.keys(entity.type_probs))entity.type_probs[label]*=.92;entity.type_probs[detection.label]=(entity.type_probs[detection.label]||0)+clamp(detection.score||.5);entity.box=entity.box.map((value,index)=>value*.72+detection.box[index]*.28);entity.lastSeen=time;entity.geometry_history.push({time,box:[...detection.box],label:detection.label,confidence:detection.score});if(entity.geometry_history.length>40)entity.geometry_history.shift()
      const ranked=Object.entries(entity.type_probs).sort((a,b)=>b[1]-a[1]),runner=ranked[1]?.[1]||0,total=ranked.reduce((sum,item)=>sum+item[1],0)||1,top=ranked[0]?.[0],topShare=(ranked[0]?.[1]||0)/total,ambiguous=runner/(ranked[0]?.[1]||1)>.25,requiredShare=top==='bed'?.86:top==='chair'?.78:.74,candidate=ambiguous||topShare<requiredShare?'furniture_surface':top||'furniture_surface'
      if(candidate===entity.stable_type){entity.pending_type=null;entity.stableFrames=0}
      else if(candidate==='furniture_surface'||(ranked[0][1]-runner)/total>=this.switchMargin){if(entity.pending_type===candidate)entity.stableFrames++;else{entity.pending_type=candidate;entity.stableFrames=1}if(entity.stableFrames>=this.confirmFrames){entity.stable_type=candidate;entity.pending_type=null;entity.stableFrames=0}}
      else{entity.pending_type=null;entity.stableFrames=0}
    }
    return this.snapshot()
  }
  relationFor(box){const bottom=box[3],center=boxCenter(box),entity=[...this.entities.values()].filter(item=>Math.max(0,Math.min(box[2],item.box[2])-Math.max(box[0],item.box[0]))>.04&&bottom>=item.box[1]-.08&&bottom<=item.box[3]+.18&&center.y<=item.box[3]+.08).sort((a,b)=>iou(b.box,box)-iou(a.box,box))[0];return entity?`on:${entity.surface_id}`:'floor'}
  updateRelation(subject,time){
    if(!subject.subject_id)return null;const candidate=this.relationFor(subject.box),state=this.relations.get(subject.subject_id)||{stable:null,pending:null,frames:0,since:time}
    if(candidate===state.stable){state.pending=null;state.frames=0;this.relations.set(subject.subject_id,state);return null}
    if(candidate!==state.pending){state.pending=candidate;state.frames=1;state.pendingSince=time;this.relations.set(subject.subject_id,state);return null}
    state.frames++;if(state.frames<this.relationFrames||time-state.pendingSince<this.relationSeconds){this.relations.set(subject.subject_id,state);return null}
    const previous=state.stable,confirmationFrames=state.frames;state.stable=candidate;state.since=state.pendingSince;state.pending=null;state.frames=0;this.relations.set(subject.subject_id,state);if(!previous)return null
    const fromEntity=previous.startsWith('on:')?this.entities.get(previous.slice(3)):null,toEntity=candidate.startsWith('on:')?this.entities.get(candidate.slice(3)):null
    if((fromEntity&&toEntity)||(!fromEntity&&!toEntity)||time-Number(state.lastEventAt??-Infinity)<this.cooldownSeconds)return null
    const action=fromEntity?'jumping_off':'jumping_on',from={surface:fromEntity?.stable_type||'floor',surface_id:fromEntity?.surface_id||null},to={surface:toEntity?.stable_type||'floor',surface_id:toEntity?.surface_id||null};if(from.surface_id&&to.surface_id&&from.surface_id===to.surface_id)return null
    state.lastEventAt=time;return {id:`surface_${subject.subject_id}_${Math.round(time*1000)}`,start:state.pendingSince,end:time,actor:subject.subject_id,action,from,to,confidence:clamp(.62+Math.min(.24,confirmationFrames*.06)),importance:.7,description:`${subject.subject_id} changes support from ${from.surface} to ${to.surface}.`,source:'surface-v3'}
  }
  snapshot(){return [...this.entities.values()].map(entity=>({...entity,type_probs:{...entity.type_probs},geometry_history:[...entity.geometry_history]}))}
  reset(){this.entities.clear();this.relations.clear();this.nextId=1}
}

export class PersistentHandDogRelations{
  constructor({confirmFrames=3,confirmSeconds=.3,maxGapSeconds=.5,minTravel=.008,cooldownSeconds=1.2}={}){Object.assign(this,{confirmFrames,confirmSeconds,maxGapSeconds,minTravel,cooldownSeconds});this.states=new Map()}
  update({subjectId,time,contact=false,handPoints=[]}={}){if(!subjectId)return {active:false,event:null};const points=handPoints.flat().filter(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y)),centroid=points.length?{x:points.reduce((sum,point)=>sum+point.x,0)/points.length,y:points.reduce((sum,point)=>sum+point.y,0)/points.length}:null,state=this.states.get(subjectId)||{frames:0,start:time,last:time,travel:0,lastCentroid:null,lastEventAt:-Infinity,active:false};if(!contact||time-state.last>this.maxGapSeconds){state.frames=0;state.start=time;state.travel=0;state.active=false;state.lastCentroid=null}if(contact){if(!state.frames)state.start=time;state.frames++;if(centroid&&state.lastCentroid)state.travel+=distance(centroid,state.lastCentroid);state.lastCentroid=centroid;state.last=time;state.active=state.frames>=this.confirmFrames&&time-state.start>=this.confirmSeconds&&state.travel>=this.minTravel;let event=null;if(state.active&&time-state.lastEventAt>=this.cooldownSeconds){state.lastEventAt=time;event=makeEvent({id:`hand_${subjectId}_${Math.round(time*1000)}`,start:state.start,end:time,actor:subjectId,action:'petting',target:'person_1',confidence:.74,importance:.92,description:`A person repeatedly strokes ${subjectId}.`,source:'relation-v3',evidence:{hand_contact_frames:state.frames,hand_travel:state.travel}})}this.states.set(subjectId,state);return {active:state.active,event}}state.last=time;this.states.set(subjectId,state);return {active:false,event:null}}
  reset(){this.states.clear()}
}

export function classifyPosture(points=[]){
  const point=index=>points[index]&&Number(points[index].score)>.3?points[index]:null,neck=point(3),tail=point(4),front=[point(7),point(10)].filter(Boolean),rear=[point(13),point(16)].filter(Boolean),paws=[...front,...rear]
  if(!neck||!tail||paws.length<3)return {posture:'unknown',confidence:0}
  const bodyLength=Math.max(.03,distance(neck,tail)),bodyVertical=Math.abs(neck.y-tail.y)/bodyLength,bodyHorizontal=Math.abs(neck.x-tail.x)/bodyLength,pawY=median(paws.map(item=>item.y)),bodyY=(neck.y+tail.y)/2,gap=(pawY-bodyY)/bodyLength,base=median([neck.score,tail.score,...paws.map(item=>item.score)])
  if(bodyHorizontal>.78&&gap<.72)return {posture:'lying',confidence:clamp(base*.84)}
  if(gap>.95&&bodyVertical<.78)return {posture:'standing',confidence:clamp(base*.78)}
  const frontY=front.length?median(front.map(item=>item.y)):pawY,rearY=rear.length?median(rear.map(item=>item.y)):pawY
  if(rearY-frontY<.08*bodyLength&&gap>.55)return {posture:'sitting',confidence:clamp(base*.68)}
  if(gap<.95&&bodyY>Math.min(...paws.map(item=>item.y))-.16)return {posture:'crouching',confidence:clamp(base*.62)}
  return {posture:'unknown',confidence:base*.4}
}

export class TemporalPostureClassifier{
  constructor({confirmFrames=3,minConfidence=.55}={}){Object.assign(this,{confirmFrames,minConfidence});this.states=new Map()}
  update(subjectId,points,time){const candidate=classifyPosture(points),state=this.states.get(subjectId)||{stable:'unknown',pending:null,frames:0};if(candidate.confidence<this.minConfidence||candidate.posture==='unknown')return {candidate:candidate.posture,confidence:candidate.confidence,stable:state.stable,transition:null};if(candidate.posture===state.stable){state.pending=null;state.frames=0;this.states.set(subjectId,state);return {candidate:candidate.posture,confidence:candidate.confidence,stable:state.stable,transition:null}}if(candidate.posture!==state.pending){state.pending=candidate.posture;state.frames=1;state.since=time;state.confidence=candidate.confidence}else{state.frames++;state.confidence=Math.max(state.confidence,candidate.confidence)}let transition=null;if(state.frames>=this.confirmFrames){const previous=state.stable;state.stable=state.pending;state.pending=null;state.frames=0;if(previous!=='unknown')transition={previous,current:state.stable,start:state.since,end:time,confidence:state.confidence}}this.states.set(subjectId,state);return {candidate:candidate.posture,confidence:candidate.confidence,stable:state.stable,transition}}
  reset(){this.states.clear()}
}

export function mergeCandidateIntervals(candidates=[],gapSeconds=1.2,maxWindowSeconds=10){
  const ordered=candidates.filter(Boolean).sort((a,b)=>a.start-b.start||a.end-b.end),merged=[]
  for(const candidate of ordered){const previous=merged.at(-1),combinedEnd=Math.max(previous?.end||0,candidate.end);if(previous&&candidate.start<=previous.end+gapSeconds&&combinedEnd-previous.start<=maxWindowSeconds){previous.end=combinedEnd;previous.reasons=[...new Set([...(previous.reasons||[]),...(candidate.reasons||[])])];previous.subjects=[...new Set([...(previous.subjects||[]),...(candidate.subjects||[])])];previous.salience=Math.max(previous.salience||0,candidate.salience||0)}else merged.push({...candidate,reasons:[...(candidate.reasons||[])],subjects:[...(candidate.subjects||[])]})}
  return merged
}

export function generateCandidateIntervals(observations=[],duration=0,{coverageSeconds=12}={}){
  const candidates=[]
  for(let index=1;index<observations.length;index++){const previous=observations[index-1],current=observations[index],reasons=[],subjects=[]
    if(current.events?.length){reasons.push(...current.events.map(event=>event.action));subjects.push(...current.events.map(event=>event.actor).filter(Boolean))}
    if(current.identity_decisions?.some(item=>['revived','uncertain'].includes(item.identity_decision)))reasons.push('identity_discontinuity')
    const persistentHands=current.relations?.filter(item=>item.type==='hand_dog'&&item.persistent)||[];if(persistentHands.length){reasons.push('petting_signal');subjects.push(...persistentHands.map(item=>item.first).filter(Boolean))}
    if(current.relations?.some(item=>item.changed))reasons.push('relationship_change')
    if(current.object_candidates?.some(item=>item.new||item.mouth_proximity))reasons.push('object_interaction')
    const motion=current.subjects?.filter(item=>Number(item.world_motion?.magnitude||0)>.035)||[];if(motion.length){reasons.push('world_motion');subjects.push(...motion.map(item=>item.subject_id).filter(Boolean))}
    if(reasons.length){const highRelation=reasons.includes('object_interaction')||reasons.includes('relationship_change'),salience=reasons.includes('petting_signal') ? .98 : (highRelation ? .9 : .65);candidates.push({id:`candidate_${index}`,start:Math.max(0,previous.time-.6),end:Math.min(duration||current.time,current.time+.9),reasons,subjects,salience})}
  }
  for(let at=0;at<duration;at+=coverageSeconds)candidates.push({id:`coverage_${Math.round(at)}`,start:at,end:Math.min(duration,at+Math.min(5,coverageSeconds*.45)),reasons:['temporal_coverage'],subjects:[],salience:.35})
  return mergeCandidateIntervals(candidates)
}

export function parseVisionStructuredPayload(value){
  if(value&&typeof value==='object'){if(Array.isArray(value))return {events:value};if(Array.isArray(value.events))return value;if(value.action)return {events:[value]};return null}
  const raw=String(value||'').trim();if(!raw||isVisionSchemaEcho(raw))return null
  const normalized=raw.replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/^```(?:json)?\s*|\s*```$/gi,'').trim(),starts=[normalized.indexOf('{'),normalized.indexOf('[')].filter(index=>index>=0).sort((a,b)=>a-b)
  for(const start of starts){const opener=normalized[start],closer=opener==='{'?'}':']',end=normalized.lastIndexOf(closer);if(end<=start)continue;let candidate=normalized.slice(start,end+1).replace(/,\s*([}\]])/g,'$1');const attempts=[candidate,candidate.replace(/([{,]\s*)'([^'\\]+)'\s*:/g,'$1"$2":').replace(/:\s*'([^'\\]*)'\s*([,}\]])/g,':"$1"$2')];for(const attempt of attempts){try{const parsed=JSON.parse(attempt);if(Array.isArray(parsed))return {events:parsed};if(Array.isArray(parsed?.events))return parsed;if(parsed&&typeof parsed==='object'&&parsed.action)return {events:[parsed]}}catch{}}
  }
  return null
}

export function validateStructuredVision(value,{interval={start:0,end:0},knownSubjects=[]}={}){
  if(typeof value==='string'&&isVisionSchemaEcho(value))return {valid:false,events:[],context:null,errors:['schema_echo_or_template']}
  const parsed=parseVisionStructuredPayload(value)
  if(!parsed||!Array.isArray(parsed.events))return {valid:false,events:[],context:null,errors:['invalid_json_or_schema']}
  const errors=[],events=[]
  for(const raw of parsed.events){if(!raw||typeof raw!=='object')continue;const rawAction=String(raw.action||'').trim().toLowerCase().replace(/[\s-]+/g,'_');if(isVisionSchemaEcho(JSON.stringify(raw))||PIPE_ACTION_LIST.test(rawAction)||!ALL_V3_ACTIONS.has(canonicalAction(rawAction))){errors.push(`unsupported_or_template_action:${raw.action}`);continue}const action=canonicalAction(rawAction),actor=String(raw.actor_ref||raw.actor||raw.subject||'').trim();if(!actor){errors.push('missing_actor');continue}if(knownSubjects.length&&!knownSubjects.includes(actor)&&!/^person_\d+$/.test(actor)){errors.push(`unknown_actor:${actor}`);continue}const hasConfidence=raw.confidence!==undefined&&raw.confidence!==null&&raw.confidence!=='',confidence=hasConfidence?clamp(raw.confidence):(V3_HIGH_SPECIFICITY.has(action)?0:.68);if(V3_HIGH_SPECIFICITY.has(action)&&confidence<.82){errors.push(`low_specificity_confidence:${action}`);continue}const suppliedDescription=raw.description??raw.detail??raw.evidence?.[0]??'',observation=cleanNaturalLanguageObservation(suppliedDescription);if(suppliedDescription&&!observation){errors.push(`invalid_observation:${action}`);continue}const hasStart=Number.isFinite(Number(raw.start)),hasEnd=Number.isFinite(Number(raw.end)),start=Math.max(interval.start,hasStart?Number(raw.start):interval.start),end=Math.min(interval.end||Infinity,Math.max(start,hasEnd?Number(raw.end):interval.end||start)),objectValue=raw.object_label??raw.object,objects=objectValue?[typeof objectValue==='string'?{label:objectValue}:objectValue]:[];events.push(makeEvent({id:raw.id,actor,action,target:raw.target_ref??raw.target??null,start,end,from:raw.surface_before?{surface:raw.surface_before}:null,to:raw.surface_after?{surface:raw.surface_after}:null,objects,confidence,importance:Math.min(1,(raw.importance??confidence)+.08),description:observation||`${actor} ${action.replaceAll('_',' ')}.`,source:'visionpsy-v3',evidence:{reasons:Array.isArray(raw.evidence)?raw.evidence.map(cleanNaturalLanguageObservation).filter(Boolean):[]}}))}
  return {valid:errors.length===0||events.length>0,events,context:parsed.context&&typeof parsed.context==='object'?parsed.context:null,errors}
}

const FALLBACK_PATTERNS=[['tail_wagging',/\b(?:tail wag\w*|wag\w* (?:its|the) tail|scodinzol\w*)\b/i],['petting',/\b(?:pet(?:s|ted|ting)?|accarezz\w*)\b/i],['lying_down',/\b(?:lies? down|lying down|si sdraia)\b/i],['standing_up',/\b(?:stands? up|gets? up|si alza)\b/i],['mouth_contact',/\b(?:mouth contact|grabs? (?:it|the object|the toy)|afferra\w*.*bocca)\b/i],['holding',/\b(?:holds? (?:the )?(?:toy|object)|tiene.*(?:gioco|oggetto))\b/i],['playing',/\b(?:plays? with|playing with|gioca con)\b/i],['sniffing',/\b(?:sniff\w*|annus\w*)\b/i]]
export function conservativeVisionFallback(text,{interval={start:0,end:0},actor='subject_1',confidence=.72}={}){const observation=cleanNaturalLanguageObservation(text);if(!observation)return [];const events=[];for(const [action,pattern] of FALLBACK_PATTERNS)if(pattern.test(observation))events.push(makeEvent({start:interval.start,end:interval.end,actor,action,confidence,importance:.72,description:observation,source:'visionpsy-v3-fallback',evidence:{fallback:true}}));return events}

export function reconcileV3Events(events=[],{sessionDuration=0,maxEvents=12}={}){
  const rejected=[],safe=[]
  for(const input of events){const event=makeEvent(input),fromId=event.from?.surface_id,toId=event.to?.surface_id,fromFurniture=Boolean(fromId)||event.from?.surface&&!['floor','ground'].includes(event.from.surface),toFurniture=Boolean(toId)||event.to?.surface&&!['floor','ground'].includes(event.to.surface);if(NOISE_ACTIONS.has(event.action)||event.confidence<.48)continue;if(event.action==='scene_change'&&event.source==='surface-v3'){rejected.push({event,reason:'surface_scene_change'});continue}if(['jumping_on','jumping_off'].includes(event.action)&&((fromId&&toId&&fromId===toId)||(fromFurniture&&toFurniture))){rejected.push({event,reason:'invalid_support_transition'});continue}safe.push(event)}
  const merged=mergeEvents(safe,{gapSeconds:1.4,maxContinuousGapSeconds:3.2})
  const conflicts=new Map()
  for(const event of merged){const key=`${event.actor}:${Math.round((event.start+event.end)/4)}`,list=conflicts.get(key)||[];list.push(event);conflicts.set(key,list)}
  const final=[]
  for(const list of conflicts.values()){list.sort((a,b)=>b.confidence-a.confidence);for(const event of list){const contradiction=final.find(item=>item.actor===event.actor&&Math.max(item.start,event.start)<=Math.min(item.end,event.end)&&((item.action==='jumping_on'&&event.action==='jumping_off')||(item.action==='jumping_off'&&event.action==='jumping_on')));if(contradiction&&contradiction.confidence>=event.confidence){rejected.push({event,reason:'lower_confidence_contradiction'});continue}final.push(event)}}
  const story=selectDeepV3StoryEvents(final,{sessionDuration,maxEvents})
  return {events:final.sort((a,b)=>a.start-b.start),story,rejected}
}

const HIGH_NARRATIVE_ACTIONS=new Set(['petting','person_dog_interaction','dog_dog_interaction','jumping_off','jumping_on','rolling','tail_wagging','object_presented','mouth_contact','picking_up','holding','carrying','playing','tugging','dropping'])
const SUPPORT_ACTIONS=new Set(['jumping_off','jumping_on'])
export function selectDeepV3StoryEvents(events=[],{sessionDuration=0,maxEvents=12}={}){const valid=events.map(makeEvent).filter(event=>event.action!=='scene_change'&&event.confidence>=.48),hasSemantic=valid.some(event=>HIGH_NARRATIVE_ACTIONS.has(event.action)&&!SUPPORT_ACTIONS.has(event.action)),priority=event=>{const posture=event.action.endsWith('_up')||event.action.endsWith('_down'),base=HIGH_NARRATIVE_ACTIONS.has(event.action)?1:(posture ? .2 : .45);return base+event.importance*.45+event.confidence*.3},ranked=valid.sort((a,b)=>priority(b)-priority(a)),chosen=[],support=[];for(const event of ranked){if(SUPPORT_ACTIONS.has(event.action)){support.push(event);continue}if(chosen.length<maxEvents)chosen.push(event)}for(const event of support.slice(0,hasSemantic?2:maxEvents-chosen.length))if(chosen.length<maxEvents)chosen.push(event);return chosen.sort((a,b)=>a.start-b.start)}

export function evaluateRegressionV001(actualEvents=[],expected={},summaryEvents=null){
  const final=actualEvents.map(event=>makeEvent(event)),required=(expected.beats||[]).filter(beat=>beat.required),matches=[]
  for(const beat of required){const actions=new Set(beat.actions||[]),match=final.find(event=>actions.has(event.action)&&event.end>=beat.start-(beat.tolerance||4)&&event.start<=beat.end+(beat.tolerance||4));matches.push({id:beat.id,matched:Boolean(match),eventId:match?.id||null})}
  const subjectIds=new Set(final.map(event=>event.actor).filter(actor=>/^subject_\d+$/.test(actor))),falseBedTransitions=final.filter(event=>['jumping_on','jumping_off','scene_change'].includes(event.action)&&[event.from?.surface,event.to?.surface].includes('bed')).length,cameraNoise=final.filter(event=>NOISE_ACTIONS.has(event.action)).length,requiredRecall=required.length?matches.filter(item=>item.matched).length/required.length:0,highSalience=final.filter(event=>event.importance>=.7||event.confidence>=.82),summary=Array.isArray(summaryEvents)?summaryEvents.map(event=>makeEvent(event)):final,summaryKeys=new Set(summary.map(event=>`${event.actor}|${event.action}|${Math.round(event.start)}`)),summaryCoverage=highSalience.length?highSalience.filter(event=>[...summaryKeys].some(key=>{const [actor,action,start]=key.split('|');return actor===String(event.actor)&&action===event.action&&Math.abs(Number(start)-event.start)<=4})).length/highSalience.length:1
  return {required_total:required.length,required_matched:matches.filter(item=>item.matched).length,required_recall:requiredRecall,persistent_dog_identities:subjectIds.size,dog_3_events:final.filter(event=>/^(?:Dog|Cane) 3$/i.test(String(event.actor))).length,false_bed_transitions:falseBedTransitions,camera_motion_story_events:cameraNoise,high_salience_summary_coverage:summaryCoverage,matches,pass:requiredRecall>=6/7&&subjectIds.size<=2&&falseBedTransitions===0&&cameraNoise===0&&summaryCoverage>=.75}
}

export class DeepVideoDebugRecorder{
  constructor({sessionId=`deep_${Date.now()}`,source=null}={}){this.session_id=sessionId;this.source=source;this.analysis_mode='recorded_deep_v3';this.version=DEEP_VIDEO_V3_VERSION;this.pass_a={frames_processed:0,effective_detector_fps:0,pose_frames:0};this.camera_motion_metrics={frames:0,confident_frames:0,mean_confidence:0};this.identity_metrics={persistent_subjects:0,matched:0,revived:0,new:0,uncertain:0};this.surface_entities=[];this.candidate_intervals=[];this.vision_metrics={vision_calls:0,useful_vision_responses:0,valid_structured_responses:0,repaired_responses:0,fallback_parsed_responses:0,discarded_responses:0,structured_events_created:0};this.semantic_events_before_reconciliation=[];this.identity_reconciliation=[];this.surface_reconciliation=[];this.semantic_events_final=[];this.summary_input=[];this.final_summary='';this.observations=[];this.dropped_events=[]}
  recordObservation(value){this.observations.push(value);this.pass_a.frames_processed=this.observations.length}
  recordIdentity(decision){this.identity_reconciliation.push(decision);const key=decision.identity_decision;if(key in this.identity_metrics)this.identity_metrics[key]++}
  recordVision(result){for(const [key,value] of Object.entries(result.metrics||{}))this.vision_metrics[key]=(this.vision_metrics[key]||0)+Number(value||0);if(result.decisions)this.dropped_events.push(...result.decisions.filter(item=>item.status==='rejected'))}
  finalize({events=[],story=[],summary='',surfaces=[]}={}){this.semantic_events_final=events;this.summary_input=story;this.final_summary=summary;this.surface_entities=surfaces;this.identity_metrics.persistent_subjects=new Set(this.identity_reconciliation.map(item=>item.subject_id).filter(Boolean)).size}
  toJSON(){return {...this,exported_at:new Date().toISOString()}}
  download(filename=`ai-pet-detective-${this.session_id}.json`){if(typeof document==='undefined')return this.toJSON();const url=URL.createObjectURL(new Blob([JSON.stringify(this.toJSON(),null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),500);return this.toJSON()}
}
