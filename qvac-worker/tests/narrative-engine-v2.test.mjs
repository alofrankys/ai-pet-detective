import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TailWagDetector,StateStabilizer,BooleanIntervalDetector,estimateCameraMotion,compensateMotion,mergeEvents,
  selectNarrativeEvents,summaryPayload,SessionDebugRecorder,NarrativeEngineV2
} from '../public/narrative-engine-v2.js'

test('generic camera-relative motion is removed from narrative events',()=>{
  const selected=selectNarrativeEvents([
    {id:'a',start:1,end:1.2,actor:'Dog 1',action:'moved_left',confidence:.95,description:'Dog 1 moved left'},
    {id:'b',start:2,end:4,actor:'Dog 1',action:'petting',confidence:.82,description:'A person pets Dog 1'}
  ],{sessionDuration:5})
  assert.equal(selected.length,1)
  assert.equal(selected[0].action,'petting')
})

test('continuous petting observations merge into one interval',()=>{
  const merged=mergeEvents([
    {id:'a',start:10,end:11,actor:'Dog 1',action:'petting',confidence:.72,description:'A person pets Dog 1'},
    {id:'b',start:11.5,end:12.5,actor:'Dog 1',action:'petting',confidence:.84,description:'A person continues petting Dog 1'},
    {id:'c',start:13,end:14,actor:'Dog 1',action:'petting',confidence:.78,description:'Dog 1 is being petted'}
  ])
  assert.equal(merged.length,1)
  assert.equal(merged[0].start,10)
  assert.equal(merged[0].end,14)
  assert.equal(merged[0].confidence,.84)
})

test('tail wag requires repeated oscillation, not one displacement',()=>{
  const detector=new TailWagDetector({windowMs:1600,minSamples:5,minAmplitude:.02,minReversals:2,endHoldMs:400})
  const oneWay=[.40,.42,.44,.46,.48,.50]
  let transition=null
  oneWay.forEach((x,index)=>{transition=detector.update('Dog 1',index*150,x,.8)||transition})
  assert.equal(transition,null)
  const wag=new TailWagDetector({windowMs:1600,minSamples:5,minAmplitude:.02,minReversals:2,endHoldMs:400})
  const oscillating=[.40,.47,.39,.48,.38,.47,.40]
  let started=false
  oscillating.forEach((x,index)=>{if(wag.update('Dog 1',index*150,x,.8)?.type==='start')started=true})
  assert.equal(started,true)
})

test('state stabilizer ignores one-frame posture flicker',()=>{
  const state=new StateStabilizer({confirmMs:500})
  assert.equal(state.update('Dog 1','standing',0,.8),null)
  assert.equal(state.update('Dog 1','standing',600,.8)?.current,'standing')
  assert.equal(state.update('Dog 1','lying',700,.8),null)
  assert.equal(state.update('Dog 1','standing',850,.8),null)
  assert.equal(state.get('Dog 1'),'standing')
})

test('camera motion compensation removes shared pan',()=>{
  const camera=estimateCameraMotion([
    {dx:.05,dy:-.01,scale:.002,confidence:.8},{dx:.052,dy:-.012,scale:.001,confidence:.7},{dx:.048,dy:-.009,scale:.002,confidence:.9}
  ])
  const dog=compensateMotion({dx:.051,dy:-.011,scale:.002},camera)
  assert.ok(Math.abs(dog.dx)<.005)
  assert.ok(Math.abs(dog.dy)<.005)
})

test('story selection covers early, middle and late meaningful events',()=>{
  const selected=selectNarrativeEvents([
    {id:'1',start:2,end:5,actor:'Dog 1',action:'resting',confidence:.8,description:'Dog 1 rests on the couch'},
    {id:'2',start:20,end:24,actor:'Dog 1',action:'petting',confidence:.85,description:'A person pets Dog 1'},
    {id:'3',start:51,end:52,actor:'Dog 1',action:'jumping_off',confidence:.9,description:'Dog 1 jumps down from a bench'},
    {id:'4',start:78,end:83,actor:'Dog 1',action:'sniffing',confidence:.8,description:'Dog 1 sniffs along the path'},
    {id:'5',start:96,end:100,actor:'Dog 1',action:'playing',confidence:.88,description:'Dog 1 plays with a toy'}
  ],{sessionDuration:100,maxEvents:5})
  assert.ok(selected.some(e=>e.start<10))
  assert.ok(selected.some(e=>e.start>45&&e.start<60))
  assert.ok(selected.some(e=>e.start>90))
})

test('debug recorder preserves raw, semantic, merged and summary layers',()=>{
  const debug=new SessionDebugRecorder({sessionId:'test'})
  debug.addRaw({videoSeconds:1,detections:[{label:'dog'}]})
  debug.addSemantic({id:'x',start:1,end:2,actor:'Dog 1',action:'walking',confidence:.8,description:'Dog 1 walks'})
  debug.setMerged([{id:'x',start:1,end:2,actor:'Dog 1',action:'walking',confidence:.8,description:'Dog 1 walks'}])
  debug.setSummary('Dog 1 walks.')
  const output=debug.toJSON()
  assert.equal(output.raw.length,1)
  assert.equal(output.semantic.length,1)
  assert.equal(output.merged.length,1)
  assert.equal(output.finalSummary,'Dog 1 walks.')
})

test('surface transitions become semantic events',()=>{
  const engine=new NarrativeEngineV2({surfaceConfirmMs:300,sessionId:'surface-test'})
  engine.updateSurface('Dog 1','couch',0,.9)
  engine.updateSurface('Dog 1','couch',400,.9)
  engine.updateSurface('Dog 1','floor',500,.9)
  const event=engine.updateSurface('Dog 1','floor',900,.9)
  assert.equal(event.action,'jumping_off')
  assert.equal(event.from.surface,'couch')
  assert.equal(event.to.surface,'floor')
})

test('active continuous intervals are closed by final-session flush',()=>{
  const intervals=new BooleanIntervalDetector({startHoldMs:200,endHoldMs:500})
  intervals.update('petting:1',0,true,.8,{hands:3})
  assert.equal(intervals.update('petting:1',300,true,.85,{hands:5})?.type,'start')
  const [ended]=intervals.flush(1400)
  assert.equal(ended.type,'end')
  assert.equal(ended.start,0)
  assert.equal(ended.end,1400)
})

test('final summary payload contains merged semantic events and no camera motion',()=>{
  const payload=summaryPayload([
    {id:'noise',start:0,end:1,actor:'Dog 1',action:'moved_right',confidence:.99,description:'Dog 1 moved right'},
    {id:'p1',start:2,end:3,actor:'Dog 1',action:'petting',confidence:.8,description:'A person pets Dog 1'},
    {id:'p2',start:3.4,end:5,actor:'Dog 1',action:'petting',confidence:.86,description:'The petting continues'}
  ],{sessionDuration:6})
  assert.equal(payload.events.length,1)
  assert.equal(payload.events[0].action,'petting')
  assert.equal(payload.events[0].start,2)
  assert.equal(payload.events[0].end,5)
})
