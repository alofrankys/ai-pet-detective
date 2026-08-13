import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOMENT_LENS_MODEL,
  MOMENT_LENS_PROMPTS,
  analyseMomentLens,
  buildMomentLensRequest,
  sanitizeMomentLensAnswer
} from '../studio.mjs'

const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9])
const expectedPrompts={
  describe:`Describe the clearest visible fact involving the dog, a person, or an object in this image.

Use one short factual sentence.
Describe only what is directly visible.
Do not infer emotion, intention, or what happened before or after.
If the image is unclear, answer UNCLEAR.`,
  objects:`Describe only the clearly visible relationship between the dog and an object in this image.

Use one short factual sentence.
Do not infer an action that requires multiple moments.
If no clear dog-object relationship is visible, answer UNCLEAR.`,
  spatial:`Describe where the dog is relative to the most relevant visible person, object, or furniture.

Use one short factual sentence.
If the spatial relationship is unclear, answer UNCLEAR.`
}

test('Moment Lens uses the three exact single-image prompts',()=>{
  assert.deepEqual(MOMENT_LENS_PROMPTS,expectedPrompts)
  assert.equal(MOMENT_LENS_MODEL,'VisionPsy-Nano-460M-Flash')
})

test('Moment Lens prompts contain no schema, JSON or action vocabulary',()=>{
  const forbidden=/[{}\[\]`|]|actor_ref|target_ref|"events"|petting|lying_down|jumping_off|tail_wagging|mouth_contact|playing|running|rolling/i
  for(const prompt of Object.values(MOMENT_LENS_PROMPTS))assert.doesNotMatch(prompt,forbidden)
})

test('one frozen frame produces exactly one image and one VisionPsy call',async()=>{
  const calls=[]
  const result=await analyseMomentLens({jpeg,preset:'describe'},async(messages,maxTokens,context)=>{
    calls.push({messages,maxTokens,context})
    return 'A dog is beside a green chair.'
  },(()=>{const values=[10,34.6];return()=>values.shift()})())
  assert.equal(calls.length,1)
  assert.equal(calls[0].messages.length,1)
  assert.equal(calls[0].messages.flatMap(message=>message.content).filter(item=>item.type==='image_url').length,1)
  assert.equal(calls[0].messages.flatMap(message=>message.content).filter(item=>item.type==='text').length,1)
  assert.equal(calls[0].maxTokens,80)
  assert.deepEqual(calls[0].context,{visual_mode:'single_image',image_count:1,preserve_raw:true})
  assert.equal(result.inference_ms,24.6)
  assert.equal(result.answer,'A dog is beside a green chair.')
})

test('Moment Lens never retries or makes a repair call',async()=>{
  let calls=0
  await assert.rejects(()=>analyseMomentLens({jpeg,preset:'objects'},async()=>{calls++;throw new Error('model unavailable')}),/model unavailable/)
  assert.equal(calls,1)
})

test('UNCLEAR remains an honest unclear result',async()=>{
  const result=await analyseMomentLens({jpeg,preset:'spatial'},async()=>`  UNCLEAR.\n`)
  assert.equal(result.status,'unclear')
  assert.equal(result.answer,null)
  assert.equal(result.raw_answer,`  UNCLEAR.\n`)
  assert.equal(result.reason,'model_unclear')
})

test('a response reporting no relevant visible subject remains unclear',()=>{
  const raw='The image shows a green background with no visible dog, person, or object.'
  const result=sanitizeMomentLensAnswer(raw)
  assert.equal(result.status,'unclear')
  assert.equal(result.answer,null)
  assert.equal(result.raw_answer,raw)
  assert.equal(result.reason,'no_relevant_visible_fact')
})

test('schema, JSON, prompt echoes and oversized responses never become visible',()=>{
  const fixtures=[
    'In the video, [ { "events": [ { "actor_ref": "subject_1", "action": "petting|lying_down|standing_up|sitting_down|jumping_off|jumping_on|playing"',
    '```json\n{"events":[{"action":"playing"}]}\n```',
    'Describe the clearest visible fact involving the dog, a person, or an object in this image.',
    'Use one short factual sentence. Describe only what is directly visible.',
    `The dog is beside a chair ${'very '.repeat(80)}far away.`
  ]
  for(const fixture of fixtures){const result=sanitizeMomentLensAnswer(fixture);assert.equal(result.status,'unclear',fixture);assert.equal(result.answer,null,fixture)}
})

test('the raw answer is preserved while the visible answer stays one sentence',async()=>{
  const raw='A dog is under a wooden table. A person is visible behind it.\n'
  const result=await analyseMomentLens({jpeg,preset:'spatial'},async()=>raw)
  assert.equal(result.raw_answer,raw)
  assert.equal(result.answer,'A dog is under a wooden table.')
  assert.equal(result.status,'clear')
})

test('emotion, intention and temporal claims are rejected rather than rewritten',()=>{
  for(const claim of [
    'The happy dog is beside a red ball.',
    'The dog wants to pick up the red ball.',
    'The dog has just moved away from the chair.'
  ]){
    const result=sanitizeMomentLensAnswer(claim)
    assert.equal(result.status,'unclear')
    assert.equal(result.answer,null)
    assert.equal(result.raw_answer,claim)
  }
})

test('request builder accepts only a fixed preset and one JPEG payload',()=>{
  const request=buildMomentLensRequest({jpeg,preset:'objects'})
  assert.equal(request.prompt,MOMENT_LENS_PROMPTS.objects)
  assert.match(request.messages[0].content[0].image_url.url,/^data:image\/jpeg;base64,/)
  assert.throws(()=>buildMomentLensRequest({jpeg,preset:'custom'}),/Unknown Moment Lens preset/)
  assert.throws(()=>buildMomentLensRequest({preset:'describe'}),/requires one JPEG image/)
})
